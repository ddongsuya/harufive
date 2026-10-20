"use client";

import { useEffect, useState } from "react";
import { mountGame } from "../public/game/app.js";

/** React owns the shell; the existing game controller owns the three mount nodes. */
export default function ClientGame() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      const controller = mountGame();
      return () => controller.destroy();
    } catch {
      setFailed(true);
    }
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">본문으로 이동</a>
      <div id="app">
        <div className="boot" role="status" aria-live="polite">
          <strong>하루다섯</strong>
          <span>{failed ? "게임 화면을 불러오지 못했어요. 연결을 확인하고 다시 열어 주세요." : "오늘의 다섯 문제를 준비하고 있어요."}</span>
          {failed && <a className="btn" href="/">다시 열기</a>}
        </div>
      </div>
      <div id="toast" className="toast" role="status" aria-live="polite" />
      <dialog id="modal" aria-labelledby="modal-title" />
      <noscript>하루다섯을 즐기려면 브라우저에서 JavaScript를 켜주세요.</noscript>
    </>
  );
}
