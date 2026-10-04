'use client';

import { useEffect, useLayoutEffect } from 'react';

/**
 * useLayoutEffect where it can run, useEffect where it cannot.
 *
 * Portal-positioned surfaces must measure and place their panel *before the
 * browser paints*, otherwise the panel appears for one frame at its initial
 * coordinates and the subsequent focus() scrolls the document there. On the
 * server there is no paint to protect, and React only warns.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
