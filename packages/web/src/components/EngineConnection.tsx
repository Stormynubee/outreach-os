import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { Card, CardTitle } from './Card';
import { inputClass } from './Field';
import { Spinner } from './Spinner';
import { IconAlert, IconCheck, IconExternal, IconGlobe, IconLock } from './icons';
import { probeEngine } from '../lib/api';
import { cx } from '../lib/cx';
import { getEngineToken, getEngineUrl, isEngineSeparate, setEngineConfig } from '../lib/engine';

/**
 * Where this interface should look for the engine.
 *
 * Left empty, it talks to whatever served the page — which is the case when you run
 * `npm start` locally. Fill it in when the interface is hosted somewhere else (a static
 * host) and the engine runs on your own machine behind a tunnel.
 */
export function EngineConnectionCard(): ReactElement {
  const [url, setUrl] = useState(() => getEngineUrl());
  const [token, setToken] = useState(() => getEngineToken());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const test = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    const probe = await probeEngine(url, token);
    setResult({ ok: probe.ok, message: probe.ok ? `${probe.message} Version ${probe.version}, ${probe.leads} leads.` : probe.message });
    setTesting(false);
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setEngineConfig(url, token);
    // Every cached query and the live event stream were opened against the old
    // address, so start clean rather than leaving stale data on screen.
    window.location.reload();
  };

  return (
    <Card>
      <CardTitle hint="Leave empty when the engine serves this page">Engine connection</CardTitle>

      <p className="mt-3 max-w-2xl text-[13px] font-medium text-muted">
        The engine is the part that holds your leads and does the crawling. It always runs
        on a machine with a real disk. If you are viewing this interface somewhere other
        than that machine, put the engine&apos;s address here.
      </p>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-bold">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1',
            isEngineSeparate() ? 'bg-teal/40 text-ink' : 'bg-ink/[0.06] text-muted',
          )}
        >
          <IconGlobe className="h-3.5 w-3.5" />
          {isEngineSeparate() ? `Using ${getEngineUrl()}` : 'Using this origin'}
        </span>
        {getEngineToken() ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-ink/[0.06] px-2.5 py-1 text-muted">
            <IconLock className="h-3.5 w-3.5" />
            token set
          </span>
        ) : null}
      </p>

      <form className="mt-4 space-y-3" onSubmit={save}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <label htmlFor="engine-url" className="mb-1.5 block text-[12px] font-bold text-ink">
              Engine address
            </label>
            <input
              id="engine-url"
              name="engine-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-tunnel-host"
              autoComplete="off"
              spellCheck={false}
              className={cx(inputClass, 'font-mono text-[13px]')}
            />
            <p className="mt-1.5 text-[11px] font-medium text-muted">
              Accepts a bare host or a full URL. Leave empty to use the origin serving this page.
            </p>
          </div>

          <div>
            <label htmlFor="engine-token" className="mb-1.5 block text-[12px] font-bold text-ink">
              Access token
            </label>
            <input
              id="engine-token"
              name="engine-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="printed by the engine on startup"
              autoComplete="off"
              spellCheck={false}
              className={cx(inputClass, 'font-mono text-[13px]')}
            />
            <p className="mt-1.5 text-[11px] font-medium text-muted">
              Required whenever the engine is reachable from anywhere but this machine. It is
              stored in <code className="font-mono">data/api-token.txt</code>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2.5 text-[13px] font-extrabold text-white"
          >
            <IconCheck className="h-4 w-4" />
            Save and reload
          </button>
          <button
            type="button"
            onClick={() => {
              void test();
            }}
            disabled={testing}
            className={cx(
              'inline-flex items-center gap-2 rounded-pill bg-lime px-4 py-2.5 text-[13px] font-extrabold text-ink',
              testing && 'opacity-60',
            )}
          >
            {testing ? <Spinner size="sm" label="Testing" /> : <IconExternal className="h-3.5 w-3.5" />}
            Test connection
          </button>
          {result ? (
            <span
              role="status"
              className={cx(
                'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-bold',
                result.ok ? 'bg-lime text-ink' : 'bg-ink text-white',
              )}
            >
              {result.ok ? <IconCheck className="h-3.5 w-3.5" /> : <IconAlert className="h-3.5 w-3.5" />}
              {result.message}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
