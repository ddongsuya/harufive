"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

/** 글 상단 가장자리에 붙는 읽기 진행 막대. */
export function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const reduce = useReducedMotion();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[70] h-[3px] origin-left bg-signal"
      style={{ scaleX: reduce ? scrollYProgress : scaleX }}
    />
  );
}
