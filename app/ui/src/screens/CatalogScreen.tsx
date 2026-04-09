import { Button, Card, Tag } from "@blueprintjs/core";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import type { CatalogProduct } from "@/services/api";
import { cartTotal, useKioskStore } from "@/store/kioskStore";
import "./CatalogScreen.css";

interface Props {
  products: CatalogProduct[];
  onPay: () => void;
}

export function CatalogScreen({ products, onPay }: Props) {
  const m = useMotionConfig();
  const cart = useKioskStore((s) => s.cart);
  const addToCart = useKioskStore((s) => s.addToCart);
  const decFromCart = useKioskStore((s) => s.decFromCart);
  const clearCart = useKioskStore((s) => s.clearCart);

  const total = cartTotal(cart);

  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogProduct[]>();
    for (const p of products) {
      const k = p.category || "Otros";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  }, [products]);

  return (
    <div className="catalog-screen">
      <header className="catalog-screen__header">
        <h2 className="catalog-screen__h2">Menú</h2>
      </header>
      <div className="catalog-screen__body">
        <div className="catalog-screen__grid-wrap">
          {[...byCategory.entries()].map(([cat, items]) => (
            <section key={cat} className="catalog-screen__section">
              <h3 className="catalog-screen__h3">{cat}</h3>
              <div className="catalog-screen__grid">
                {items.map((p, idx) => {
                  const line = cart.find((c) => c.id === p.id);
                  const qty = line?.qty ?? 0;
                  return (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: m.reduced ? 0 : idx * m.stagger,
                        duration: m.reduced ? 0.01 : 0.3,
                      }}
                    >
                      <Card className="catalog-screen__card" elevation={1}>
                        <img
                          className="catalog-screen__img"
                          src={new URL(`../assets/products/${p.image}`, import.meta.url).href}
                          alt=""
                        />
                        <div className="catalog-screen__meta">
                          <div className="catalog-screen__name">{p.name}</div>
                          <div className="catalog-screen__price">${p.price.toFixed(2)}</div>
                          <div className="catalog-screen__qty">
                            <motion.div whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
                              <Button
                                icon="minus"
                                minimal
                                small
                                aria-label="Quitar"
                                onClick={() => decFromCart(p.id)}
                                disabled={qty === 0}
                              />
                            </motion.div>
                            <Tag minimal>{qty}</Tag>
                            <motion.div whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
                              <Button
                                icon="plus"
                                minimal
                                small
                                aria-label="Agregar"
                                onClick={() => addToCart(p.id, p.name, p.price)}
                              />
                            </motion.div>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <aside className="catalog-screen__cart">
          <Card className="catalog-screen__cart-card" elevation={1}>
            <h3 className="catalog-screen__cart-title">Tu carrito</h3>
            <ul className="catalog-screen__cart-list">
              {cart.map((l) => (
                <li key={l.id} className="catalog-screen__cart-line">
                  <span>
                    {l.qty}× {l.name}
                  </span>
                  <span>${(l.price * l.qty).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="catalog-screen__cart-total-row">
              <span>Total</span>
              <motion.span
                key={total}
                className="catalog-screen__total"
                initial={{ scale: 1 }}
                animate={{ scale: m.reduced ? 1 : [1, 1.15, 1] }}
                transition={{ duration: m.reduced ? 0.01 : 0.2 }}
              >
                ${total.toFixed(2)}
              </motion.span>
            </div>
            <div className="catalog-screen__cart-actions">
              <motion.div whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
                <Button
                  fill
                  intent="danger"
                  minimal
                  disabled={cart.length === 0}
                  onClick={() => clearCart()}
                >
                  Vaciar carrito
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: m.reduced ? 1 : 1.02 }} whileTap={{ scale: m.reduced ? 1 : 0.96 }}>
                <Button fill large intent="primary" disabled={cart.length === 0} onClick={onPay}>
                  Pagar
                </Button>
              </motion.div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
