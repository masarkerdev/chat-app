'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  disablePush,
  enablePush,
  isIosBrowserTab,
  isPushActive,
  onPushChange,
  permissionState,
  pushConfigured,
  pushSupported,
} from '@/lib/push';

/** হেডার মেনু ও ব্যানারের জন্য push-এর অবস্থা */
export function usePush() {
  const [active, setActive] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [supported, setSupported] = useState(true);
  const [iosTab, setIosTab] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(pushSupported() && pushConfigured());
    setIosTab(isIosBrowserTab());
    setPermission(permissionState());
    setActive(isPushActive());
    return onPushChange(() => {
      setActive(isPushActive());
      setPermission(permissionState());
    });
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    const res = await enablePush();
    setBusy(false);
    setPermission(permissionState());
    if (!res.ok && res.message) alert(res.message);
    return res.ok;
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    await disablePush();
    setBusy(false);
  }, []);

  return { active, permission, supported, iosTab, busy, enable, disable };
}
