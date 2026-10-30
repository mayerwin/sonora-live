import { useEffect } from 'preact/hooks';
import {
  Bluetooth,
  Cable,
  Check,
  ChevronDown,
  CircleHelp,
  Piano,
  Play,
  RefreshCw,
  TriangleAlert,
  Usb,
} from 'lucide-preact';
import { capital, t } from '../app/i18n.ts';
import { session } from '../app/session.ts';
import { settings, updateMidi } from '../app/settings.ts';
import { BLUEFY_IOS, browser, browserName, os, PERFECT_BT_MIDI, WEB_MIDI_BROWSER_IOS } from '../app/platform.ts';
import type { PlayOn } from '../midi/hub.ts';
import { Rich, Seg, Sheet, ToggleRow } from './common.tsx';
import { sheet } from './state.ts';

function PlatformHelp() {
  const d = session.midi.devices;
  const bt = d.bluetooth;
  return (
    <details class="details" open={os === 'windows' && !d.instruments.value.length}>
      <summary>
        <CircleHelp /> {t("Don't see your instrument?")}
        <ChevronDown class="chev" />
      </summary>
      <div class="details-body">
        {os === 'windows' && (
          <>
            <p>
              <Rich
                text={
                  bt
                    ? t(
                        '<b>Bluetooth piano on Windows?</b> Windows usually keeps Bluetooth MIDI instruments away from browsers (its new MIDI system is still rolling out). Install <a>Perfect Bluetooth MIDI for Windows</a> (free): it connects your piano and shows it here like a USB instrument, or use <b>Connect a Bluetooth instrument</b> above, which works without it in Chrome and Edge.',
                      )
                    : t(
                        '<b>Bluetooth piano on Windows?</b> Windows usually keeps Bluetooth MIDI instruments away from browsers (its new MIDI system is still rolling out). Install <a>Perfect Bluetooth MIDI for Windows</a> (free): it connects your piano and shows it here like a USB instrument.',
                      )
                }
                links={[PERFECT_BT_MIDI]}
              />
            </p>
            <p>
              <Rich
                text={t(
                  '<b>USB:</b> plug the cable in, then tap <b>Refresh</b>. Close other music apps first: on Windows an instrument can be used by one app at a time.',
                )}
              />
            </p>
          </>
        )}
        {os === 'macos' && (
          <>
            <p>
              <Rich text={t('<b>USB:</b> plug it in and tap <b>Refresh</b>.')} />
            </p>
            <p>
              <Rich
                text={
                  bt
                    ? t(
                        '<b>Bluetooth:</b> use <b>Connect a Bluetooth instrument</b> above, or pair it in Audio MIDI Setup → Window → Show MIDI Studio → Bluetooth.',
                      )
                    : t(
                        '<b>Bluetooth:</b> pair it in Audio MIDI Setup → Window → Show MIDI Studio → Bluetooth, then tap Refresh.',
                      )
                }
              />
            </p>
            {browser === 'safari' && (
              <p>
                {t('Safari has no MIDI support: open this room in Chrome, Edge or Firefox to use your instrument.')}
              </p>
            )}
          </>
        )}
        {os === 'android' && (
          <>
            <p>
              <Rich
                text={t(
                  '<b>USB:</b> connect the instrument with a USB OTG adapter (USB-C to USB-B for most pianos), then tap <b>Refresh</b>.',
                )}
              />
            </p>
            <p>
              <Rich
                text={t(
                  '<b>Bluetooth:</b> turn Bluetooth and location on, then use <b>Connect a Bluetooth instrument</b>.',
                )}
              />
            </p>
          </>
        )}
        {os === 'linux' && (
          <>
            <p>
              <Rich text={t('<b>USB:</b> plug it in and tap <b>Refresh</b>.')} />
            </p>
            <p>
              <Rich
                text={t(
                  '<b>Bluetooth:</b> pair it with your system (bluetoothctl, BlueZ with MIDI support), or enable Web Bluetooth in Chrome at <code>chrome://flags/#enable-experimental-web-platform-features</code>.',
                )}
              />
            </p>
          </>
        )}
        {os === 'chromeos' && (
          <p>
            <Rich
              text={t(
                'USB instruments appear when plugged in; Bluetooth ones with <b>Connect a Bluetooth instrument</b>.',
              )}
            />
          </p>
        )}
        {os === 'ios' && <IosHelp />}
        <p style="color:var(--muted)">
          {t(
            'Still nothing? Turn the instrument off and on, try another cable or port, and check that it is not connected to another device (a phone app, for example).',
          )}
        </p>
      </div>
    </details>
  );
}

function IosHelp() {
  return (
    <>
      <p>
        {t(
          "iPhone and iPad browsers cannot reach MIDI instruments yet (Apple's WebKit has no Web MIDI), whatever the cable. Two free apps open this same room with MIDI:",
        )}
      </p>
      <ul>
        <li>
          <Rich text={t('<a>Web MIDI Browser</a> for USB and Bluetooth instruments;')} links={[WEB_MIDI_BROWSER_IOS]} />
        </li>
        <li>
          <Rich text={t('<a>Bluefy</a> for Bluetooth instruments.')} links={[BLUEFY_IOS]} />
        </li>
      </ul>
      <p>{t('Without them, you still see and hear everything the other side plays, on the built-in piano.')}</p>
    </>
  );
}

export function MidiSheet() {
  const hub = session.midi;
  const d = hub.devices;
  const status = d.status.value;
  const list = d.instruments.value;
  const current = d.current.value;
  const connected = d.connected.value;
  const s = settings.value.midi;
  const peers = session.peers.value;
  const piano = hub.piano;
  const loaded = piano.loaded.value;
  const total = piano.total.value;
  const target = hub.target;
  const supported = d.webMidi || d.bluetooth;
  const recent = performance.now() - hub.lastLocal.value < 1500;

  // tapping MIDI is the intent: ask for access straight away
  useEffect(() => {
    if (d.webMidi && d.status.peek() === 'idle') void d.request();
  }, []);

  return (
    <Sheet title={t('Play together with MIDI')} icon={<Piano />} onClose={() => (sheet.value = null)}>
      <p class="lead" style="margin:0;color:var(--text-2)">
        {t(
          "Connect your digital piano: what you play sounds on the other side's instrument (or the built-in piano), and theirs on yours, at full quality and without going through the microphone.",
        )}
      </p>

      {!supported && (
        <div class="hint hint-warn">
          <TriangleAlert />
          <div>
            {os === 'ios' ? (
              <IosHelp />
            ) : (
              capital(
                t(
                  '{browser} cannot connect to MIDI instruments. Open this room in Chrome, Edge or Firefox to use yours. You still hear and see what the others play.',
                  { browser: browserName() },
                ),
              )
            )}
          </div>
        </div>
      )}

      {supported && (
        <div class="section">
          <h3>{t('Your instrument')}</h3>
          {status === 'asking' && (
            <div class="hint">
              <span class="spinner" />
              <span>{t("Allow MIDI access in the browser's prompt…")}</span>
            </div>
          )}
          {status === 'denied' && (
            <div class="hint hint-bad">
              <TriangleAlert />
              <span>
                {t(
                  'MIDI access was blocked. Allow it from the icon in the address bar (site settings → MIDI devices), then tap Refresh.',
                )}
              </span>
            </div>
          )}
          <div class="list" role="radiogroup" aria-label={t('MIDI instruments')}>
            {list.map((i) => {
              const sel = current === i.key;
              return (
                <button
                  class="item"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => d.select(sel ? null : i.key)}
                  data-testid="midi-instrument"
                >
                  <span class="ico">
                    {i.kind === 'bluetooth' ? <Bluetooth /> : i.kind === 'virtual' ? <Cable /> : <Usb />}
                  </span>
                  <span class="grow">
                    <div class="title">{i.name}</div>
                    <div class="sub">
                      {sel
                        ? connected
                          ? recent
                            ? t('Connected · receiving notes')
                            : t('Connected · play a few notes to check')
                          : t('Selected · not connected')
                        : i.input && i.output
                          ? t('plays & sounds')
                          : i.input
                            ? t('plays')
                            : i.output
                              ? t('sounds')
                              : t('MIDI port')}
                    </div>
                  </span>
                  {sel && connected && <Check class="check" />}
                </button>
              );
            })}
            {status === 'ready' && list.length === 0 && (
              <div class="hint">
                <Usb />
                <span>{t('No instrument found yet. Plug it in (or turn it on), then tap Refresh.')}</span>
              </div>
            )}
          </div>
          <div class="code-actions">
            {d.bluetooth && (
              <button class="btn" onClick={() => void d.connectBluetooth()} disabled={d.bleBusy.value}>
                {d.bleBusy.value ? <span class="spinner" /> : <Bluetooth />} {t('Connect a Bluetooth instrument')}
              </button>
            )}
            {d.webMidi && (
              <button class="btn btn-ghost" onClick={() => void d.request().then(() => d.refresh())}>
                <RefreshCw /> {t('Refresh')}
              </button>
            )}
          </div>
          <PlatformHelp />
        </div>
      )}

      <div class="section">
        <h3>{t("The others' playing sounds on")}</h3>
        <Seg<PlayOn>
          label={t("Where the others' notes sound")}
          value={s.playOn === 'auto' ? (d.hasOutput.value ? 'instrument' : 'piano') : s.playOn}
          onChange={(v) => {
            hub.silenceRemote();
            updateMidi({ playOn: v });
            if (v === 'piano') void piano.load();
          }}
          options={[
            { value: 'instrument', label: t('My instrument') },
            { value: 'piano', label: t('Built-in piano') },
            { value: 'off', label: t('Off') },
          ]}
        />
        {target === 'instrument' && (
          <div class="code-actions">
            <button class="btn btn-sm" onClick={() => hub.testInstrument()}>
              <Play /> {t('Test: play C–E–G on my instrument')}
            </button>
            <select
              class="select"
              style="height:34px;width:auto;border-radius:999px;font-size:13.5px"
              value={s.outChannel}
              aria-label={t('MIDI channel')}
              onChange={(e) => updateMidi({ outChannel: Number((e.currentTarget as HTMLSelectElement).value) })}
            >
              <option value={0}>{t('Channel: as played')}</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option value={i + 1}>{t('Channel {n}', { n: i + 1 })}</option>
              ))}
            </select>
          </div>
        )}
        {s.playOn === 'instrument' && !d.hasOutput.value && (
          <div class="hint">
            <Piano />
            <span>{t('No instrument output connected: the built-in piano plays meanwhile.')}</span>
          </div>
        )}
        {target === 'piano' && (
          <div class="section" style="gap:8px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="font-weight:600;white-space:nowrap">{t('Piano volume')}</span>
              <input
                class="range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={s.pianoVolume}
                onInput={(e) => updateMidi({ pianoVolume: Number((e.currentTarget as HTMLInputElement).value) })}
                aria-label={t('Built-in piano volume')}
              />
            </div>
            {total > 0 && loaded < total && (
              <div style="display:grid;gap:6px">
                <small style="color:var(--muted)">
                  {t('Loading the concert grand · {pct}%', { pct: Math.round((loaded / total) * 100) })}
                </small>
                <div class="progress">
                  <i style={{ width: `${(loaded / total) * 100}%` }} />
                </div>
              </div>
            )}
            <small style="color:var(--muted)">
              {t(
                'A Steinway concert grand, four velocity layers, real dampers and pedals. Plays through your speakers or headphones.',
              )}
            </small>
          </div>
        )}
      </div>

      <div class="section">
        <h3>{t('Options')}</h3>
        <div>
          <ToggleRow
            title={t('Send my playing to the others')}
            sub={
              connected
                ? t('Your notes and pedals reach their instrument or built-in piano.')
                : t('When an instrument is connected.')
            }
            checked={s.send}
            onChange={(v) => updateMidi({ send: v })}
          />
          <ToggleRow
            title={t('Show the piano keys')}
            sub={t("Everyone's notes light up in their colour; click or touch to play.")}
            checked={s.keyboard}
            onChange={(v) => updateMidi({ keyboard: v })}
          />
          {target === 'piano' && (
            <ToggleRow
              title={t('Concert hall reverb')}
              sub={t('A touch of room around the built-in piano.')}
              checked={s.reverb}
              onChange={(v) => updateMidi({ reverb: v })}
            />
          )}
        </div>
      </div>

      {peers.length > 0 && (
        <div class="section">
          <h3>{t('In this lesson')}</h3>
          <div class="list">
            {peers.map((p) => (
              <div class="item" data-role={p.info.role} style="cursor:default">
                <span class="ico" style="background:var(--rc);color:#141018">
                  <Piano />
                </span>
                <span class="grow">
                  <div class="title">{p.info.name}</div>
                  <div class="sub">
                    {p.remote?.midi.sending
                      ? p.remote.midi.device
                        ? t('Plays {device} over MIDI', { device: p.remote.midi.device })
                        : t('Plays an instrument over MIDI')
                      : p.remote?.midi.device
                        ? t('{device} connected, not sending', { device: p.remote.midi.device })
                        : t('No MIDI instrument')}
                    {p.remote ? ` · ${p.remote.midi.receiving ? t('hears your MIDI') : t('MIDI sound off')}` : ''}
                  </div>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="hint">
        <Piano />
        <span>
          {t(
            'With sound mode on Auto, your microphone switches to voice mode while your piano travels as MIDI: talking stays clear and the piano is not sent twice.',
          )}
        </span>
      </div>
    </Sheet>
  );
}
