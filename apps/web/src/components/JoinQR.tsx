'use client';

import { AnimatePresence, motion } from 'motion/react';
import { QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from './primitives';

/** "Scan to chat": a QR code for the phone page at this laptop's network address. */
export function JoinQR() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || url) return;
    api
      .info()
      .then(({ lan }) => {
        // A phone needs the laptop's network address, not localhost.
        const host = lan[0] ?? window.location.hostname;
        return `${window.location.protocol}//${host}:${window.location.port}/join`;
      })
      .catch(() => `${window.location.origin}/join`)
      .then(async (u) => {
        setUrl(u);
        setSvg(await QRCode.toString(u, { type: 'svg', margin: 1, color: { dark: '#0e0e10', light: '#ffffff' } }));
      });
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Button pill onClick={() => setOpen(true)} title="Let the room chat from their phones" className="max-sm:px-2">
        <QrCode className="size-4" /> <span className="max-sm:hidden">Scan to chat</span>
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-[420px] rounded-tw-lg bg-panel p-6 text-center shadow-2xl ring-1 ring-line"
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3 grid size-8 place-items-center rounded-tw text-dim hover:bg-white/[0.08] hover:text-fg"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
              <p className="label">Shipyard · live chat</p>
              <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">Scan to chat</h2>
              <p className="mt-1 text-[13px] text-dim">Post a message and watch Quell moderate it live.</p>
              <div className="mx-auto mt-5 size-[280px] overflow-hidden rounded-tw-lg bg-white p-3">
                {svg ? (
                  <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
                ) : (
                  <div className="checking size-full rounded-tw bg-black/5" />
                )}
              </div>
              <p className="mt-4 break-all font-mono text-[13px] text-purple-soft">{url ?? '…'}</p>
              <p className="mt-2 text-[11.5px] text-faint">Phones must be on the same Wi-Fi as this laptop.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
