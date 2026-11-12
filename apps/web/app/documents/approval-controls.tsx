import { type Approval, type ApprovalStep, type DocumentAttachedTo } from '@pythagoras/shared';
import { APPROVER_LABELS, approvalLabel, approversFor } from '../../lib/documents';

const ACTION = '/documents/approvals/actions';
const inline = { display: 'inline', marginLeft: '0.5rem' } as const;

/** Approve, or reject with a reason, a step waiting for the signed-in person. */
export function DecideStep({ step, back }: { step: ApprovalStep; back: string }) {
  return (
    <span data-testid={`decide-${step.id}`}>
      <form method="post" action={ACTION} style={inline}>
        <input type="hidden" name="action" value="decide" />
        <input type="hidden" name="step_id" value={step.id} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="decision" value="approved" />
        <button type="submit">{`Approve as ${APPROVER_LABELS[step.role]}`}</button>
      </form>
      <form method="post" action={ACTION} style={inline}>
        <input type="hidden" name="action" value="decide" />
        <input type="hidden" name="step_id" value={step.id} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="decision" value="rejected" />
        <input name="note" required maxLength={500} placeholder="Why it is rejected" aria-label="Reason" />
        <button type="submit">Reject</button>
      </form>
    </span>
  );
}

/**
 * A version's approval (M6.5): where it stands, the steps waiting for the
 * reader, and for those who manage the document, asking for approval of the
 * latest version or withdrawing a request on its way.
 */
export function ApprovalControls({
  approval,
  versionId,
  attachedTo,
  canAsk,
  canManage,
  back,
}: {
  approval: Approval | null;
  versionId: string;
  attachedTo: DocumentAttachedTo;
  /** The latest version of a document that is not archived, managed by the reader. */
  canAsk: boolean;
  canManage: boolean;
  back: string;
}) {
  const open = !approval || approval.status === 'rejected' || approval.status === 'withdrawn';
  const roles = approversFor(attachedTo);
  return (
    <div data-testid={`approval-${versionId}`}>
      {approval ? <p style={{ margin: '0.25rem 0' }}>{`Approval: ${approvalLabel(approval)}`}</p> : null}
      {approval?.steps
        .filter((step) => step.mayDecide)
        .map((step) => (
          <DecideStep key={step.id} step={step} back={back} />
        ))}
      {approval?.status === 'pending' && canManage ? (
        <form method="post" action={ACTION} style={inline}>
          <input type="hidden" name="action" value="withdraw" />
          <input type="hidden" name="request_id" value={approval.id} />
          <input type="hidden" name="back" value={back} />
          <button type="submit">Withdraw the request</button>
        </form>
      ) : null}
      {canAsk && open ? (
        <details>
          <summary>Ask for approval</summary>
          <form method="post" action={ACTION} style={{ display: 'grid', gap: '0.5rem', maxWidth: '30rem' }}>
            <input type="hidden" name="action" value="ask" />
            <input type="hidden" name="version_id" value={versionId} />
            <input type="hidden" name="back" value={back} />
            {[1, 2, 3].map((no) => (
              <label key={no}>
                {no === 1 ? 'First by ' : 'Then by '}
                <select name={`step_${no}`} defaultValue={no === 1 ? roles[0] : ''} required={no === 1}>
                  {no === 1 ? null : <option value="">nobody else</option>}
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {APPROVER_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="submit">Ask for approval</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
