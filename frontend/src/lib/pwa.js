'use client';

import { useEffect, useState } from 'react';

/** Status pemasangan PWA: apakah bisa dipasang, sudah terpasang, atau perangkat iOS (pasang manual). */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setInstalled(Boolean(standalone));
    setIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return false;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    setPrompt(null);
    return choice?.outcome === 'accepted';
  }

  return { canInstall: Boolean(prompt) && !installed, installed, ios, install };
}
