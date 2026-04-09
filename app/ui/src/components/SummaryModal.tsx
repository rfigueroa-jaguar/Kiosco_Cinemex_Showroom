import { Button, Classes, Dialog, HTMLTable } from "@blueprintjs/core";
import { motion } from "framer-motion";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import type { TransactionPayload } from "@/services/api";
import "./SummaryModal.css";

interface Props {
  isOpen: boolean;
  transaction: TransactionPayload;
  onConfirm: () => void;
}

export function SummaryModal({ isOpen, transaction, onConfirm }: Props) {
  const m = useMotionConfig();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {}}
      title="Resumen de compra"
      className="summary-dialog"
      canOutsideClickClose={false}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: m.reduced ? 0.01 : 0.15 }}
      >
        <div className={Classes.DIALOG_BODY}>
          <HTMLTable bordered striped className="summary-dialog__table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant.</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {transaction.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td>{it.qty}</td>
                  <td>${(it.price * it.qty).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
          <p className="summary-dialog__total">
            Total: <strong>${transaction.amount.toFixed(2)}</strong>
          </p>
          <p className="summary-dialog__pay">
            Método: {transaction.payment_method === "cash" ? "Efectivo" : "Tarjeta"}
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: m.reduced ? 0.01 : 0.2 }}
            >
              <Button intent="success" large text="Confirmar" onClick={onConfirm} />
            </motion.div>
          </div>
        </div>
      </motion.div>
    </Dialog>
  );
}
