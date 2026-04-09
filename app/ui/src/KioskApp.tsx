import { Callout, NonIdealState, Spinner } from "@blueprintjs/core";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { InactivityModal } from "@/components/InactivityModal";
import { SummaryModal } from "@/components/SummaryModal";
import { useInactivityTimer } from "@/hooks/useInactivityTimer";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import {
  abandonTransaction,
  confirmTransaction,
  getCatalog,
  getStatus,
  getTransaction,
  prepareTransaction,
  printTicket,
  setTransactionStep,
  type CatalogProduct,
  type ServiceSnapshot,
  type TransactionPayload,
} from "@/services/api";
import { CardPaymentScreen } from "@/screens/CardPaymentScreen";
import { CashPaymentScreen } from "@/screens/CashPaymentScreen";
import { CatalogScreen } from "@/screens/CatalogScreen";
import { PaymentMethodScreen } from "@/screens/PaymentMethodScreen";
import { PaymentSuccessScreen } from "@/screens/PaymentSuccessScreen";
import { QrScanScreen } from "@/screens/QrScanScreen";
import { WelcomeScreen } from "@/screens/WelcomeScreen";
import { cartTotal, useKioskStore, type KioskState } from "@/store/kioskStore";
import "./KioskApp.css";

type RecoveryPayload = {
  action: string;
  transaction?: TransactionPayload;
};

function servicesFromApi(raw: Record<string, ServiceSnapshot>): KioskState["services"] {
  const pick = (x: ServiceSnapshot | undefined, statusFallback: string) => ({
    available: x?.available ?? false,
    status: x?.status ?? statusFallback,
    ...(x?.message ? { message: x.message } : {}),
  });
  return {
    cpi: pick(raw.cpi, "unknown"),
    im30: pick(raw.im30, "unknown"),
    printer: pick(raw.printer, "unknown"),
  };
}

export function KioskApp() {
  const m = useMotionConfig();
  const screen = useKioskStore((s) => s.screen);
  const setScreen = useKioskStore((s) => s.setScreen);
  const cart = useKioskStore((s) => s.cart);
  const clearCart = useKioskStore((s) => s.clearCart);
  const resetToWelcome = useKioskStore((s) => s.resetToWelcome);
  const setServices = useKioskStore((s) => s.setServices);
  const setActiveTransaction = useKioskStore((s) => s.setActiveTransaction);
  const activeTransaction = useKioskStore((s) => s.activeTransaction);
  const paymentActive = useKioskStore((s) => s.paymentActive);
  const setCatalogLoaded = useKioskStore((s) => s.setCatalogLoaded);
  const setBootError = useKioskStore((s) => s.setBootError);
  const bootError = useKioskStore((s) => s.bootError);
  const services = useKioskStore((s) => s.services);
  const cpiAvail = services.cpi.available;
  const im30Avail = services.im30.available;

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [booting, setBooting] = useState(true);
  const [idleModalOpen, setIdleModalOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const cartEmpty = cart.length === 0;

  const goWelcome = useCallback(() => {
    setIdleModalOpen(false);
    void abandonTransaction();
    resetToWelcome();
    setScreen("welcome");
  }, [resetToWelcome, setScreen]);

  const runPrintAndQr = useCallback(async () => {
    const t = await getTransaction();
    if (!t.success || !t.data) return;
    const tx = t.data;
    const pr = await printTicket({
      transaction_id: tx.transaction_id,
      items: tx.items,
      total: tx.amount,
      payment_method: tx.payment_method,
      last_four: tx.last_four ?? undefined,
    });
    if (!pr.success) {
      console.warn(pr.error);
    }
    await setTransactionStep({ step: "waiting_qr" });
    const t2 = await getTransaction();
    if (t2.success && t2.data) setActiveTransaction(t2.data);
  }, [setActiveTransaction]);

  const handleCashSuccess = useCallback(async () => {
    await setTransactionStep({ step: "printing" });
    await runPrintAndQr();
    setScreen("payment_success");
  }, [runPrintAndQr, setScreen]);

  const handleCardApproved = useCallback(async () => {
    await runPrintAndQr();
    setScreen("payment_success");
  }, [runPrintAndQr, setScreen]);

  const handleRecoveryPrint = useCallback(
    async (tx: TransactionPayload) => {
      setActiveTransaction(tx);
      await setTransactionStep({ step: "printing" });
      await runPrintAndQr();
      setScreen("payment_success");
    },
    [runPrintAndQr, setActiveTransaction, setScreen]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBooting(true);
      const [st, cat] = await Promise.all([getStatus(), getCatalog()]);
      if (cancelled) return;
      if (!st.success) {
        setBootError(st.error || "Sin conexión con el servidor");
        setBooting(false);
        return;
      }
      setServices(servicesFromApi(st.data.services));
      const rec = st.data.recovery as RecoveryPayload | null | undefined;
      if (!cat.success || !cat.data?.items?.length) {
        setBootError(cat.success === false ? cat.error || "Catálogo vacío" : "Catálogo vacío");
        setBooting(false);
        return;
      }
      setProducts(cat.data.items);
      setCatalogLoaded(true);
      setBootError(null);

      if (rec?.action === "go_qr" && rec.transaction) {
        setActiveTransaction(rec.transaction);
        setScreen("qr_scan");
      } else if (rec?.action === "resume_print" && rec.transaction) {
        await handleRecoveryPrint(rec.transaction);
      } else if (rec?.action === "reset_to_welcome") {
        setScreen("welcome");
      }

      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [handleRecoveryPrint, setActiveTransaction, setBootError, setCatalogLoaded, setScreen, setServices]);

  useEffect(() => {
    if (booting || bootError) return;
    const id = window.setInterval(() => {
      void getStatus().then((res) => {
        if (res.success) setServices(servicesFromApi(res.data.services));
      });
    }, 10_000);
    return () => window.clearInterval(id);
  }, [booting, bootError, setServices]);

  const hardwareAlertLines = useMemo(() => {
    const lines: string[] = [];
    for (const key of ["cpi", "im30", "printer"] as const) {
      const svc = services[key];
      if (!svc.available && svc.message) lines.push(svc.message);
    }
    return lines;
  }, [services]);

  const onPay = useCallback(() => {
    setIdleModalOpen(false);
    setScreen("payment_method");
  }, [setScreen]);

  const startPaymentFlow = useCallback(
    async (method: "cash" | "card") => {
      const amount = cartTotal(cart);
      const items = cart.map((c) => ({ ...c }));
      const prep = await prepareTransaction({
        payment_method: method,
        amount,
        items,
      });
      if (!prep.success) {
        console.error(prep.error);
        return;
      }
      setActiveTransaction(prep.data);
      setScreen(method === "cash" ? "cash_payment" : "card_payment");
    },
    [cart, setActiveTransaction, setScreen]
  );

  const onPickCash = useCallback(() => void startPaymentFlow("cash"), [startPaymentFlow]);
  const onPickCard = useCallback(() => void startPaymentFlow("card"), [startPaymentFlow]);

  const { bumpActivity } = useInactivityTimer({
    screen,
    cartEmpty,
    paymentActive,
    modalOpen: idleModalOpen,
    onEmptyTimeout: goWelcome,
    onShowModal: () => setIdleModalOpen(true),
    onModalTimeout: () => {
      setIdleModalOpen(false);
      clearCart();
      void abandonTransaction();
      resetToWelcome();
      setScreen("welcome");
    },
    onQrTimeout: () => {
      void abandonTransaction();
      resetToWelcome();
      setScreen("welcome");
    },
  });

  useEffect(() => {
    if (screen === "catalog" || screen === "payment_method") {
      bumpActivity();
    }
  }, [screen, cart, bumpActivity]);

  const onConfirmSummary = useCallback(async () => {
    setSummaryOpen(false);
    await confirmTransaction();
    clearCart();
    resetToWelcome();
    setScreen("welcome");
  }, [clearCart, resetToWelcome, setScreen]);

  const motionDuration = m.reduced ? 0.01 : 0.25;

  const paymentMethodScreen = useMemo(
    () => (
      <PaymentMethodScreen
        cpiAvailable={cpiAvail}
        im30Available={im30Avail}
        cpiDetail={services.cpi.message}
        im30Detail={services.im30.message}
        onCash={onPickCash}
        onCard={onPickCard}
        onBack={() => setScreen("catalog")}
      />
    ),
    [cpiAvail, im30Avail, onPickCash, onPickCard, services.cpi.message, services.im30.message, setScreen]
  );

  const screenNode = (() => {
    if (booting) {
      return (
        <div className="kiosk-app__center" key="boot">
          <Spinner size={50} />
        </div>
      );
    }
    if (bootError) {
      return (
        <div className="kiosk-app__center" key="err">
          <NonIdealState icon="error" title="No se pudo iniciar" description={bootError} />
        </div>
      );
    }
    switch (screen) {
      case "welcome":
        return <WelcomeScreen key="welcome" onStart={() => setScreen("catalog")} />;
      case "catalog":
        return <CatalogScreen key="catalog" products={products} onPay={onPay} />;
      case "payment_method":
        return <div key="paym">{paymentMethodScreen}</div>;
      case "cash_payment":
        return (
          <CashPaymentScreen
            key="cash"
            amount={activeTransaction?.amount ?? cartTotal(cart)}
            onSuccess={() => void handleCashSuccess()}
            onAbort={() => {
              void abandonTransaction();
              setActiveTransaction(null);
              setScreen("payment_method");
            }}
          />
        );
      case "card_payment":
        return (
          <CardPaymentScreen
            key={activeTransaction?.transaction_id ?? "card"}
            onApproved={() => void handleCardApproved()}
            onCancel={() => {
              void abandonTransaction();
              setActiveTransaction(null);
              setScreen("payment_method");
            }}
          />
        );
      case "payment_success":
        return <PaymentSuccessScreen key="success" onContinue={() => setScreen("qr_scan")} />;
      case "qr_scan":
        if (!activeTransaction) {
          return (
            <div className="kiosk-app__center" key="qr-empty">
              <NonIdealState title="Sin transacción activa" />
            </div>
          );
        }
        return (
          <QrScanScreen
            key="qr"
            expectedId={activeTransaction.transaction_id}
            transaction={activeTransaction}
            onValid={() => setSummaryOpen(true)}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className="kiosk-app">
      {hardwareAlertLines.length > 0 && !booting && !bootError && (
        <div className="kiosk-app__banner">
          <Callout intent="warning" icon="warning-sign">
            {hardwareAlertLines.map((line, i) => (
              <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
            ))}
          </Callout>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          className="kiosk-app__stage"
          initial={{ x: 48, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -48, opacity: 0 }}
          transition={{ duration: motionDuration, ease: "easeInOut" }}
        >
          {screenNode}
        </motion.div>
      </AnimatePresence>

      <InactivityModal
        isOpen={idleModalOpen}
        onContinue={() => {
          setIdleModalOpen(false);
          bumpActivity();
        }}
        onCancelPurchase={() => {
          setIdleModalOpen(false);
          clearCart();
          void abandonTransaction();
          resetToWelcome();
          setScreen("welcome");
        }}
        onTimeout={() => {
          setIdleModalOpen(false);
          clearCart();
          void abandonTransaction();
          resetToWelcome();
          setScreen("welcome");
        }}
      />

      {activeTransaction && (
        <SummaryModal
          isOpen={summaryOpen}
          transaction={activeTransaction}
          onConfirm={() => void onConfirmSummary()}
        />
      )}
    </div>
  );
}
