"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Toaster } from "react-hot-toast";

export function ScaffoldToaster() {
  const [host, setHost] = useState<HTMLElement>();
  useEffect(() => {
    // Native modal dialogs sit above every document z-index. Keep one toaster
    // inside the active dialog's top layer so notifications stay visible/clickable.
    const update = () =>
      setHost(Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal")).at(-1) ?? document.body);
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return host ? createPortal(<Toaster containerStyle={{ zIndex: 2147483647 }} />, host) : null;
}
