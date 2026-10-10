import React from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

// Slide stays within the page's horizontal padding, so nothing overflows.
const TRANSITION = { duration: 0.24, ease: [0.22, 1, 0.36, 1] };

export default function RouteTransition({ children }) {
  const { pathname } = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="route-transition"
        initial={{ opacity: 0.4, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0.4, x: -18 }}
        transition={TRANSITION}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}