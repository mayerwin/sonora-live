import { Copy, Eye, Lock, LockOpen, Minus, Plus, Share2, Users } from 'lucide-preact';
import { session } from '../app/session.ts';
import { update } from '../app/settings.ts';
import { prettyCode } from '../net/code.ts';
import { Qr, Sheet, ToggleRow } from './common.tsx';
import { sheet } from './state.ts';
import { canShare, copyLink, roomLink, shareLink } from './share.ts';
import { t, tn } from '../app/i18n.ts';

export function ShareSheet() {
  const code = session.code.value;
  const link = roomLink(code);
  const watchLink = roomLink(code, true);
  return (
    <Sheet title={t('Invite to this lesson')} icon={<Share2 />} onClose={() => (sheet.value = null)}>
      <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <Qr text={link} />
        <div style="display:grid;gap:12px;flex:1;min-width:220px">
          <span class="label">{t('Room code')}</span>
          <div class="code" style="font-size:34px">
            {prettyCode(code)
              .split(' ')
              .map((p) => (
                <span>{p}</span>
              ))}
          </div>
          <input
            class="input"
            readOnly
            value={link}
            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
            aria-label={t('Room link')}
          />
          <div class="code-actions">
            <button class="btn btn-primary" onClick={() => void copyLink(code)}>
              <Copy /> {t('Copy link')}
            </button>
            {canShare && (
              <button class="btn" onClick={() => void shareLink(code)}>
                <Share2 /> {t('Share…')}
              </button>
            )}
          </div>
        </div>
      </div>
      <p class="lead" style="margin:0;color:var(--text-2)">
        {t('They open the link, or type the code on Sonora Live, and appear here.')}
      </p>
      <div class="section" data-testid="watch-link">
        <h3>
          <Eye size={15} style="vertical-align:-2px" /> {t('To watch: a parent, a guest, a second camera')}
        </h3>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <Qr text={watchLink} />
          <div style="display:grid;gap:10px;flex:1;min-width:220px">
            <p class="lead" style="margin:0">
              {t(
                'With this link they watch and listen, without being asked to play. Scan it with a phone to add a second camera, for example pointed at the keys.',
              )}
            </p>
            <div class="code-actions">
              <button class="btn" onClick={() => void copyLink(code, true)}>
                <Copy /> {t('Copy the link to watch')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export function LockSheet() {
  const policy = session.policy.value;
  const count = 1 + session.peers.value.length;
  const set = (locked: boolean, limit: number) => {
    session.setPolicy({ locked, limit });
    update({ lockRooms: locked, roomLimit: limit });
  };
  return (
    <Sheet
      title={t('Who can join')}
      icon={policy.locked ? <Lock /> : <LockOpen />}
      onClose={() => (sheet.value = null)}
    >
      <ToggleRow
        title={t('Limit the room to {n} people', { n: policy.limit })}
        sub={
          policy.locked
            ? t('Anyone else with the link has to knock; someone inside can let them in.')
            : t('Anyone with the link or the code can join.')
        }
        checked={policy.locked}
        onChange={(v) => set(v, policy.limit)}
      />
      <div class="row-toggle" style={policy.locked ? undefined : 'opacity:.45;pointer-events:none'}>
        <Users size={20} color="var(--muted)" />
        <div class="grow">
          <div class="row-title">{t('Room size')}</div>
          <div class="row-sub">
            {tn(count, '{n} person here now, everyone included', '{n} people here now, everyone included')}
          </div>
        </div>
        <button
          class="icon-btn"
          aria-label={t('Allow one person fewer')}
          onClick={() => set(true, Math.max(2, policy.limit - 1))}
          disabled={policy.limit <= 2}
        >
          <Minus />
        </button>
        <b style="min-width:26px;text-align:center;font-size:20px" aria-live="polite">
          {policy.limit}
        </b>
        <button
          class="icon-btn"
          aria-label={t('Allow one more person')}
          onClick={() => set(true, Math.min(12, policy.limit + 1))}
          disabled={policy.limit >= 12}
        >
          <Plus />
        </button>
      </div>
      <p style="margin:0;color:var(--muted);font-size:13.5px">
        {t(
          'Everyone in the room can change this. Rooms are private by design: the code is only known to the people you send it to, and everything travels end-to-end encrypted.',
        )}
      </p>
    </Sheet>
  );
}
