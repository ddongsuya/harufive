"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** 기기 설정(동작 줄이기)을 그대로 존중한다. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
