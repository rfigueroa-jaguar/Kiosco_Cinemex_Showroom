import { Button } from "@blueprintjs/core";
import { motion } from "framer-motion";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import "./WelcomeScreen.css";

interface Props {
  onStart: () => void;
}

export function WelcomeScreen({ onStart }: Props) {
  const m = useMotionConfig();

  const container = {
    hidden: {},
    show: {
      transition: { staggerChildren: m.reduced ? 0 : 0.15 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: m.fast } },
  };

  return (
    <motion.div
      className="welcome-screen"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item} className="welcome-screen__brand">
        <div className="welcome-screen__logo" aria-hidden />
        <h1 className="welcome-screen__title">Dulcería Cinemex</h1>
      </motion.div>
      <motion.div variants={item}>
        <motion.div whileHover={{ scale: m.reduced ? 1 : 1.02 }} whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
          <Button large intent="primary" className="welcome-screen__cta" onClick={onStart}>
            Toca la pantalla para comenzar
          </Button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
