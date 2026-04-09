import { Button, Callout, Card } from "@blueprintjs/core";
import { motion } from "framer-motion";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import "./PaymentMethodScreen.css";

interface Props {
  cpiAvailable: boolean;
  im30Available: boolean;
  cpiDetail?: string;
  im30Detail?: string;
  onCash: () => void;
  onCard: () => void;
  onBack: () => void;
}

export function PaymentMethodScreen({
  cpiAvailable,
  im30Available,
  cpiDetail,
  im30Detail,
  onCash,
  onCard,
  onBack,
}: Props) {
  const m = useMotionConfig();

  return (
    <div className="payment-method">
      <Card className="payment-method__card" elevation={1}>
        <h2 className="payment-method__title">Método de pago</h2>
        {!cpiAvailable && (
          <Callout intent="warning" title="Pago en efectivo no disponible" className="payment-method__callout">
            {cpiDetail ?? "El servicio de reciclado no está disponible en este momento."}
          </Callout>
        )}
        {!im30Available && (
          <Callout intent="warning" title="Pago con tarjeta no disponible" className="payment-method__callout">
            {im30Detail ?? "La terminal no responde. Usa otro método o intenta más tarde."}
          </Callout>
        )}
        <div className="payment-method__actions">
          <motion.div whileHover={{ scale: m.reduced ? 1 : 1.02 }} whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
            <Button large fill intent="success" disabled={!cpiAvailable} onClick={onCash}>
              Efectivo
            </Button>
          </motion.div>
          <motion.div whileHover={{ scale: m.reduced ? 1 : 1.02 }} whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
            <Button large fill intent="primary" disabled={!im30Available} onClick={onCard}>
              Tarjeta
            </Button>
          </motion.div>
          <Button minimal onClick={onBack}>
            Volver al menú
          </Button>
        </div>
      </Card>
    </div>
  );
}
