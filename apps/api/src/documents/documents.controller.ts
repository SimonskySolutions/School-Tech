import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  APPROVER_ROLES,
  type MyApprovals,
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_BYTES,
  type DownloadLink,
  type SchoolDocuments,
} from '@pythagoras/shared';
import { type Request, type Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  addVersion,
  archiveDocument,
  createDocument,
  DocumentRejected,
  issueLink,
  redeemLink,
  refusalsAsDocuments,
  schoolDocuments,
} from './documents.repository';
import {
  cleanFileName,
  contentDisposition,
  isDocumentType,
  looksLike,
  newToken,
  sha256,
  TOKEN,
  tokenHash,
} from './files';
import { OBJECT_STORE, type ObjectStore } from './object-store';
import { decideStep, myApprovals, requestApproval, withdrawApproval } from './approvals.repository';

export const documentSchema = z
  .strictObject({
    attachedTo: z.enum(['school', 'staff', 'student']),
    schoolId: z.uuid().optional(),
    personId: z.uuid().optional(),
    title: z.string().trim().min(1).max(200),
    category: z.enum(DOCUMENT_CATEGORIES),
    forAllStaff: z.boolean().optional(),
  })
  .refine((body) => (body.attachedTo === 'staff') === (body.schoolId === undefined), {
    message: 'a school or a student document names its school; a staff document does not',
  })
  .refine((body) => (body.attachedTo === 'school') === (body.personId === undefined), {
    message: 'a staff or a student document names its person; a school document does not',
  })
  .refine((body) => !body.forAllStaff || body.attachedTo === 'school', {
    message: 'only a school document is for all staff',
  });

export const approvalSchema = z.strictObject({ steps: z.array(z.enum(APPROVER_ROLES)).min(1).max(4) });
export const decisionSchema = z
  .strictObject({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() })
  .refine((body) => body.decision === 'approved' || (body.note ?? '') !== '', {
    message: 'say why it is rejected',
  });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestException(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid request',
    );
  }
  return parsed.data;
}

/** The request body as bytes, refusing more than the limit before reading it all. */
export async function readUpload(
  request: AsyncIterable<Buffer> & { headers: Request['headers'] },
  limit: number,
) {
  if (Number(request.headers['content-length'] ?? 0) > limit) {
    throw new DocumentRejected(413, 'a file may be at most 10 MB');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new DocumentRejected(413, 'a file may be at most 10 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The upload's declared type and name (percent-encoded in X-File-Name). */
export function describeUpload(headers: Request['headers']) {
  const type = (headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!isDocumentType(type)) {
    throw new DocumentRejected(415, 'PDF, PNG, JPEG, text, Word, Excel or OpenDocument files only');
  }
  const header = headers['x-file-name'];
  try {
    return {
      type,
      fileName: cleanFileName(decodeURIComponent(typeof header === 'string' ? header : ''), type),
    };
  } catch {
    throw new BadRequestException('X-File-Name: percent-encode the file name');
  }
}

function asHttp(error: unknown): unknown {
  if (!(error instanceof DocumentRejected)) return error;
  if (error.status === 404) return new NotFoundException(error.message);
  if (error.status === 403) return new ForbiddenException(error.message);
  if (error.status === 409) return new ConflictException(error.message);
  if (error.status === 422) return new UnprocessableEntityException(error.message);
  return new HttpException(error.message, error.status);
}

async function refused<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw asHttp(error);
  }
}

const run = <T>(database: Database, principal: Principal, work: (tx: PersonTransaction) => Promise<T>) =>
  refused(() => refusalsAsDocuments(() => database.withPerson(principal, work)));

/** A school's documents (M6.4, ADR 0029). */
@Controller('schools/:schoolId/documents')
export class SchoolDocumentsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolDocuments> {
    return run(this.database, principal, async (tx) => {
      const found = await schoolDocuments(tx, schoolId);
      if (!found) throw new DocumentRejected(404, 'no such school, or not yours to see');
      return found;
    });
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Optional() @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
  ) {}

  private objects(): ObjectStore {
    if (!this.store) throw new ServiceUnavailableException('document storage is not configured');
    return this.store;
  }

  @Post()
  @HttpCode(201)
  create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(documentSchema, body);
    return run(this.database, principal, (tx) => createDocument(tx, data));
  }

  /** The next version: the file itself as the body, its name in X-File-Name. */
  @Put(':documentId/file')
  @HttpCode(201)
  async upload(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Req() request: Request,
  ) {
    const store = this.objects();
    const { type, fileName } = await refused(() => Promise.resolve(describeUpload(request.headers)));
    const bytes = await refused(() => readUpload(request, DOCUMENT_MAX_BYTES));
    if (bytes.length === 0) throw new UnprocessableEntityException('the file is empty');
    if (!looksLike(type, bytes)) throw new UnprocessableEntityException('the file is not what its type says');
    return run(this.database, principal, async (tx) => {
      const version = await addVersion(tx, documentId, {
        fileName,
        contentType: type,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
      });
      // In the same transaction: a failed upload leaves no version behind.
      await store.put(version.objectKey, bytes, type);
      return { versionId: version.versionId, versionNo: version.versionNo, fileName };
    });
  }

  @Post(':documentId/archive')
  @HttpCode(200)
  archive(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ) {
    return run(this.database, principal, (tx) => archiveDocument(tx, documentId));
  }

  /** A single-use link to a version, for the signed-in person, valid for two minutes. */
  @Post('versions/:versionId/links')
  @HttpCode(201)
  link(
    @CurrentPrincipal() principal: Principal,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ): Promise<DownloadLink> {
    const token = newToken();
    return run(this.database, principal, async (tx) => ({
      token,
      expiresAt: (await issueLink(tx, versionId, tokenHash(token))).toISOString(),
    }));
  }

  /** Asks for the version to be approved by these roles, in this order (M6.5). */
  @Post('versions/:versionId/approvals')
  @HttpCode(201)
  requestApproval(
    @CurrentPrincipal() principal: Principal,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body() body: unknown,
  ) {
    const { steps } = parse(approvalSchema, body);
    return run(this.database, principal, (tx) => requestApproval(tx, versionId, steps));
  }

  @Post('approvals/:requestId/withdraw')
  @HttpCode(200)
  withdrawApproval(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ) {
    return run(this.database, principal, (tx) => withdrawApproval(tx, requestId));
  }

  @Post('approval-steps/:stepId/decision')
  @HttpCode(200)
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('stepId', new ParseUUIDPipe()) stepId: string,
    @Body() body: unknown,
  ) {
    const { decision, note } = parse(decisionSchema, body);
    return run(this.database, principal, (tx) => decideStep(tx, stepId, decision, note || null));
  }

  /** The approval steps waiting for the signed-in person. */
  @Get('approvals/waiting')
  waiting(@CurrentPrincipal() principal: Principal): Promise<MyApprovals> {
    return run(this.database, principal, (tx) => myApprovals(tx));
  }

  /** Redeems a link: the file, as an attachment, once. */
  @Get('files/:token')
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!TOKEN.test(token)) throw new NotFoundException('the link has expired or been used');
    const store = this.objects();
    // The object is opened before the link is spent: if the store fails, the
    // link stays usable and no download is logged.
    const { file, body } = await run(this.database, principal, async (tx) => {
      const file = await redeemLink(tx, tokenHash(token));
      return { file, body: await store.get(file.objectKey) };
    });
    response.set({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(body, {
      type: file.contentType,
      disposition: contentDisposition(file.fileName),
      length: file.sizeBytes,
    });
  }
}
