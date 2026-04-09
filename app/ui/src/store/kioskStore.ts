import { create } from "zustand";
import type { CartLine, TransactionPayload } from "@/services/api";

export type Screen =
  | "welcome"
  | "catalog"
  | "payment_method"
  | "cash_payment"
  | "card_payment"
  | "payment_success"
  | "qr_scan";

export interface ServiceInfo {
  available: boolean;
  status: string;
  /** Texto para mostrar al usuario cuando el servicio no está disponible */
  message?: string;
}

export interface KioskState {
  screen: Screen;
  cart: CartLine[];
  services: {
    cpi: ServiceInfo;
    im30: ServiceInfo;
    printer: ServiceInfo;
  };
  activeTransaction: TransactionPayload | null;
  recoveryHint: { action: string; transaction?: TransactionPayload } | null;
  paymentActive: boolean;
  catalogLoaded: boolean;
  bootError: string | null;

  setScreen: (s: Screen) => void;
  setServices: (s: KioskState["services"]) => void;
  setRecovery: (r: KioskState["recoveryHint"]) => void;
  setActiveTransaction: (t: TransactionPayload | null) => void;
  setPaymentActive: (v: boolean) => void;
  setCatalogLoaded: (v: boolean) => void;
  setBootError: (e: string | null) => void;

  addToCart: (id: string, name: string, price: number) => void;
  decFromCart: (id: string) => void;
  clearCart: () => void;
  resetToWelcome: () => void;
}

const defaultServices = {
  cpi: { available: false, status: "unknown" },
  im30: { available: false, status: "unknown" },
  printer: { available: false, status: "unknown" },
};

export const useKioskStore = create<KioskState>((set, get) => ({
  screen: "welcome",
  cart: [],
  services: defaultServices,
  activeTransaction: null,
  recoveryHint: null,
  paymentActive: false,
  catalogLoaded: false,
  bootError: null,

  setScreen: (screen) => set({ screen }),
  setServices: (services) => set({ services }),
  setRecovery: (recoveryHint) => set({ recoveryHint }),
  setActiveTransaction: (activeTransaction) => set({ activeTransaction }),
  setPaymentActive: (paymentActive) => set({ paymentActive }),
  setCatalogLoaded: (catalogLoaded) => set({ catalogLoaded }),
  setBootError: (bootError) => set({ bootError }),

  addToCart: (id, name, price) => {
    const cart = [...get().cart];
    const i = cart.findIndex((c) => c.id === id);
    if (i >= 0) cart[i] = { ...cart[i], qty: cart[i].qty + 1 };
    else cart.push({ id, name, price, qty: 1 });
    set({ cart });
  },

  decFromCart: (id) => {
    const cart = [...get().cart];
    const i = cart.findIndex((c) => c.id === id);
    if (i < 0) return;
    if (cart[i].qty <= 1) cart.splice(i, 1);
    else cart[i] = { ...cart[i], qty: cart[i].qty - 1 };
    set({ cart });
  },

  clearCart: () => set({ cart: [] }),

  resetToWelcome: () =>
    set({
      screen: "welcome",
      cart: [],
      activeTransaction: null,
      recoveryHint: null,
      paymentActive: false,
    }),
}));

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + l.price * l.qty, 0);
}
