# 0029 Private document store

Date: 2026-11-01 · Status: Accepted

## Context

M6.4 adds documents attached to a school (policies, plans), a member of staff (a contract, a certificate) or a student (a report, a letter). The brief asks for S3-compatible private object storage, local object storage in development, and access restrictions on files. M6.5 (approvals) and M6.6 (consent) build on it.

Documents can hold personal data, some of it about children. They must never be reachable without a check of who is asking, every download must be accountable (who, what, when: ADR 0006's access log), and the files must survive and be restorable with the database that describes them.

The object store was chosen on 2026-11-01 after checking current releases and licences:

| Option | Licence | State on 2026-11-01 | Verdict |
| --- | --- | --- | --- |
| MinIO (community edition) | AGPL-3.0 | Community images stopped in October 2025, maintenance mode from December 2025, the repository archived in April 2026; no security fixes | Rejected: unmaintained |
| Garage (Deuxfleurs) | AGPL-3.0 | v2.5.0 (2026-10-24), v2.4.1 (2026-09-08); a single static binary in a minimal image; built for small self-hosted clusters; S3 API with SigV4 and presigned URLs; no bucket versioning or object lock | **Chosen**, v2.4.1 |
| SeaweedFS | Apache-2.0 (enterprise features under a separate EULA) | 4.x releases through 2026; master, volume, filer and S3 components | Capable, but more parts to run and back up than this needs |
| RustFS | Apache-2.0 | 1.0 GA on 2026-09-16, 1.0.4 on 2026-10-25; several features still preview | Promising, too young for children's records |
| Ceph RGW | LGPL | Mature | Far too heavy for one group of schools |

## Decision

**Garage v2.4.1** (`dxflrs/garage:v2.4.1`, pinned by digest) runs as its own container, unmodified. The AGPL applies to Garage itself; the platform only talks to it over the S3 API, and since we neither modify nor distribute Garage, no source obligation arises. Changing Garage's code would oblige us to offer that source to its users. v2.5.0 is eight days old and rewrites the resync manager; it is taken once it has settled (`docs/operations.md`, Upgrades). The application uses only `PutObject`, `GetObject` and `DeleteObject` with SigV4, so any S3 service in the EU (or SeaweedFS, RustFS) can replace Garage without code changes.

**The store is private.** It listens only on the internal Compose network: no host port, no gateway route. Only the API holds credentials: one key with read and write on one bucket, `pythagoras-documents`. Browsers never see the store or a presigned URL.

**Postgres describes, the store holds bytes.** Schema `documents`: `documents.document` (attached to a school, a member of staff or a student; a title and a category; archived rather than deleted) and `documents.version` (append-only: number, file name, type, size, SHA-256, who uploaded it, when). Each version is its own object, written once and never changed, so Garage's lack of bucket versioning does not matter. Object keys are `v1/<document id>/<version id>`: no names, titles or file names. A version is recorded in the same transaction that uploads its object, so a failed upload leaves no row. A commit that fails after the upload leaves an unreferenced object, found by comparing keys (`docs/operations.md`).

**What may be uploaded.** At most 10 MB, of the types PDF, PNG, JPEG, plain text, Word (.docx), Excel (.xlsx), OpenDocument text and spreadsheet. The first bytes must match the declared type, and file names are cleaned of paths and control characters. There is no virus scanning yet: files are always downloaded as attachments, never shown inline, with `nosniff` and a sandboxing content security policy. Scanning is to be added before families may upload (they cannot). Health and dietary information stays in its own records (ADR 0006, 0020), not in documents.

**Who sees what.**

| Attached to | Read | Upload, archive |
| --- | --- | --- |
| A school | `documents.read` there (principals and school administrators; group administrators and the CEO everywhere); if marked for all staff, also anyone with a live role at the school | `documents.manage` there (principals, school administrators, group administrators) |
| A member of staff | The person, and `staff.read` where they work now (as qualifications, ADR 0028) | `staff.manage` where they work now |
| A student | `documents.read` at the school that recorded it, while the student is or was enrolled there | `documents.manage` there, for a student enrolled there now |

Families do not see student documents yet; sharing a document with guardians is a later decision.

**Downloads only through short-lived links.** Someone allowed to read a version asks for a link. The API makes a random 32-byte token, stores only its SHA-256 with the version, the person and an expiry two minutes ahead, and returns the token. The portal sends the browser to `/documents/files/<token>`. That page passes the token, with the signed-in person's own credentials, to the API. The API redeems the link once and only for that person: it checks again that they may read the document, marks the link used, writes `audit.access_log` (`download`, `documents.version`, the student or member of staff concerned, the school) in the same transaction, then streams the object. A copied link is useless to anyone else, and useless to the person after first use or two minutes.

**Encryption and backups.** Encryption at rest is the disk's, as for PostgreSQL (production requires encrypted volumes). Garage's SSE-C is not used, so a lost key cannot lose documents. The document volumes are backed up with the database, objects first and then the database, so every version the database knows has its object. Restore in the reverse order.

## Consequences

- Retention and erasure: documents are archived, not deleted. Erasure under retention periods (for example when an employment ends plus the labour-law period) is to be built with the retention work for staff records; the keys make it a matter of deleting rows and objects together.
- When someone leaves the group, their staff documents are readable only by them until that retention exists; group HR access to former staff is a later decision.
- A production deployment runs Garage with `replication_factor = 3` on three nodes, or one node with frequent off-site copies (`docs/operations.md`).
- M6.5 approves a `documents.version`; since a version never changes, an approved version stays approved.
