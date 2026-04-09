# UI_GUIDELINES — Showroom Design System

> Estos lineamientos están extraídos del proyecto **RedFox** y son de aplicación **obligatoria** en todos los proyectos del Showroom. Cualquier componente de interfaz debe seguir estas reglas antes de ser aprobado. Modo oscuro no soportado — light mode únicamente.

---

## Stack de referencia

Estos lineamientos asumen el siguiente stack. No usar otras librerías de componentes o frameworks de CSS fuera de los aquí definidos.

| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript |
| Componentes UI | Blueprint.js v6 |
| Gráficas | Recharts v3 |
| Estilos | CSS puro con variables (sin Tailwind, sin styled-components) |
| Desktop shell | Electron (la UI corre como si fuera web — Blueprint.js funciona sin cambios) |

---

## 1. Framework

| Dependencia | Versión | Uso |
|---|---|---|
| `@blueprintjs/core` | ^6.3.1 | Componentes base (Button, Dialog, Card, Tag, Spinner, Callout, NonIdealState) |
| `@blueprintjs/icons` | ^6.1.0 | Iconografía estándar |
| `@blueprintjs/select` | ^6.0.5 | Selects, dropdowns, filtros |
| `@blueprintjs/datetime` | ^6.0.5 | Date pickers, date range inputs |
| `recharts` | ^3.2.1 | Gráficas y visualización de datos |

**Regla:** Todo componente de interfaz debe usar Blueprint.js como base. No mezclar con Material UI, Ant Design, Chakra u otras librerías de componentes.

---

## 2. Tipografía

| Contexto | Font Family | Tamaño | Peso |
|---|---|---|---|
| Títulos de página (h1) | `'Source Sans Pro', sans-serif` | 28px | 600 |
| Subtítulos (h2) | `'Source Sans Pro', sans-serif` | 24px | 600 |
| Secciones (h3) | `'Source Sans Pro', sans-serif` | 18px | 600 |
| Body / Texto general | `'Inter', sans-serif` | 14px | 400 |
| Labels / Etiquetas | `'Roboto', sans-serif` | 13px | 500 |
| Texto pequeño | `'Inter', sans-serif` | 12px | 400–500 |
| Valores métricos (KPIs) | `'Source Sans Pro', sans-serif` | 28px desktop / 24px tablet / 20px mobile | 600 |
| Código / Monospace | `'SF Mono', 'Fira Code', 'Consolas', monospace` | 12px | 400 |
| Texto mínimo (badges) | `'Inter', sans-serif` | 10–11px | 600 |

**Fallback del sistema:**
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
  'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
```

---

## 3. Paleta de Colores

### Primarios
| Nombre | HEX | Uso |
|---|---|---|
| Brand Red | `#E53E3E` | Color principal RedFox, acentos críticos |
| Primary Blue | `#3182CE` | Botones, links, badges interactivos |
| Primary Green | `#38A169` | Éxito, estados activos |
| Primary Purple | `#805AD5` | Acentos secundarios |

### Estados (Intent)
| Intent | HEX | Uso |
|---|---|---|
| Success | `#38A169` | Operaciones exitosas, activo, en línea |
| Warning | `#DD6B20` | Alertas, precaución |
| Danger | `#E53E3E` | Errores, fuera de línea, eliminación |
| Info | `#3182CE` | Información, notificaciones |
| Critical | `#DC2626` | Alertas críticas |
| Warning Yellow | `#F59E0B` | Alertas secundarias |

### Texto
| Contexto | HEX |
|---|---|
| Texto primario | `#1A202C` |
| Texto secundario | `#4A5568` |
| Texto terciario / muted | `#718096` |
| Texto en labels | `#667085` |
| Texto sobre fondo oscuro | `#FFFFFF` |

### Fondos
| Contexto | HEX |
|---|---|
| Fondo principal (página) | `#FFFFFF` |
| Fondo secundario (secciones) | `#F7FAFC` |
| Fondo terciario (alternado) | `#EDF2F7` |
| Fondo de inputs | `#F3F6FA` |
| Hover en filas de tabla | `#F8F9FA` |
| Header de tabla | `#D9E1EF` |

### Bordes
| Contexto | HEX |
|---|---|
| Borde ligero | `#E2E8F0` |
| Borde medio | `#CBD5E0` |
| Borde oscuro | `#A0AEC0` |
| Borde de input | `#D0D5DD` |
| Borde de componentes BP | `rgba(16, 22, 26, 0.1)` |

### Tags de Estado
| Estado | Background | Color texto |
|---|---|---|
| Activo | `#D4EDDA` | `#155724` |
| Inactivo | `#F8D7DA` | `#721C24` |
| Suspendido | `#FFF3CD` | `#856404` |
| Pendiente | `#D1ECF1` | `#0C5460` |

### Variables CSS — declarar en `theme.css`
```css
:root {
  --color-primary-red: #E53E3E;
  --color-primary-blue: #3182CE;
  --color-primary-green: #38A169;
  --color-primary-purple: #805AD5;
  --color-status-success: #38A169;
  --color-status-warning: #DD6B20;
  --color-status-danger: #E53E3E;
  --color-status-info: #3182CE;
  --color-text-primary: #1A202C;
  --color-text-secondary: #4A5568;
  --color-text-tertiary: #718096;
  --color-border-light: #E2E8F0;
  --color-border-medium: #CBD5E0;
  --color-background-primary: #FFFFFF;
  --color-background-secondary: #F7FAFC;
  --color-background-tertiary: #EDF2F7;
}
```

---

## 4. Layout y Breakpoints

```css
:root {
  --breakpoint-mobile: 480px;
  --breakpoint-tablet: 768px;
  --breakpoint-desktop: 1024px;
  --breakpoint-large-desktop: 1440px;
}
```

| Breakpoint | Rango | Ajustes |
|---|---|---|
| Mobile | < 480px | 1 columna, padding 12px, fuentes reducidas |
| Tablet | 480px – 768px | 1–2 columnas, padding 16px |
| Desktop | 768px – 1024px | Layout completo, sidebar visible |
| Large Desktop | > 1024px | Sidebar 200px fijo, padding 24px |

**Estructura base:**
```
┌──────────────────────────────────────────┐
│ Header (72px desktop / 56px mobile)      │
├────────┬─────────────────────────────────┤
│Sidebar │ Contenido Principal             │
│ 200px  │ padding: 24px                   │
└────────┴─────────────────────────────────┘
```

- Sidebar: 200px desktop, colapsable en < 1024px (drawer 240px)
- Header: 72px desktop / 60px tablet / 56px mobile
- Padding contenido: 24px desktop / 16px tablet / 12px mobile

---

## 5. Componentes

### Tablas
- Usar `<HTMLTable>` de Blueprint o tablas HTML estándar.
- Header: background `#D9E1EF`, texto `#667085`, Inter 12px weight 500.
- Celdas: padding 12px, borde `1px solid #D9E1EF`.
- Row hover: background `#F8F9FA`.
- Filas clickeables: `cursor: pointer` con clase `.row-clickable`.
- Border-radius contenedor: 3px.
- Box-shadow: `0px 1px 1px 0px rgba(16,22,26,0.2), 0px 0px 0px 1px rgba(16,22,26,0.1)`.

### Cards
- Usar `<Card>` de Blueprint con `elevation={1}`.
- Padding: 15–20px.
- Border-radius: 3px (default) u 8px para cards modernas.
- Shadow default: `0px 1px 1px rgba(16,22,26,0.2), 0px 0px 0px 1px rgba(16,22,26,0.1)`.
- Shadow hover: `0px 2px 4px rgba(16,22,26,0.15), 0px 0px 0px 1px rgba(16,22,26,0.1)`.
- Cards clickeables: `transform: translateY(-2px)` en hover, transición `0.2s ease`.

### Metric Cards (KPIs)
- Min height: 118px desktop / 100px tablet / 90px mobile.
- Borde izquierdo 4px coloreado por intent (danger, warning, success, primary).
- Título: Roboto 14px weight 400.
- Valor: Source Sans Pro 28px weight 600.
- Transiciones: `box-shadow 0.2s ease, transform 0.1s ease`.

### Botones
- Usar `<Button>` de Blueprint con intents: `primary`, `success`, `warning`, `danger`.
- Altura: 30–44px según contexto.
- Font weight: 500–600.
- Border-radius: 3px (Blueprint default).
- **No crear estilos de botón custom.** Siempre usar el componente de Blueprint.

### Tags / Badges
- Usar `<Tag>` de Blueprint con prop `minimal` para estilos sutiles.
- Padding: 4px 8px.
- Border-radius: 12px (redondeado) o 3px (cuadrado).
- Usar intents de Blueprint para colores de estado.

### Diálogos / Modales
- Usar `<Dialog>` de Blueprint.
- Ancho mobile: max 95vw.
- Backdrop: `rgba(16, 22, 26, 0.7)`.
- Body padding: 20px desktop / 16px tablet / 12px mobile.

### Filtros
- Fondo `#FFFFFF`, padding 13px, borde `1px solid rgba(16,22,26,0.1)`, border-radius 3px.
- Layout: flexbox row (desktop), column (mobile).
- Gap: 20px desktop / 16px tablet / 12px mobile.

### Estados de Carga
- Cargando: `<Spinner>` de Blueprint, size 30–40.
- Sin datos: `<NonIdealState>` con icono, título y descripción.
- Error: `<NonIdealState>` con `icon="error"` y botón reintentar, o `<Callout intent="danger">`.

### Tooltips
- Usar `<Tooltip>` de Blueprint.
- Siempre agregar `hoverOpenDelay={150}` y `hoverCloseDelay={100}`.
- Texto: 12px, weight 500–600.

### Notificaciones / Toasts
- Panel lateral 420px desktop / 100% max 420px mobile.
- Borde izquierdo 4px por severidad:
  - Info: `#3182CE` | Warning: `#F59E0B` | Error: `#EF4444` | Critical: `#DC2626`
- Badge de conteo: fondo `#3182CE`, texto blanco, border-radius 12px.

---

## 6. Inputs y Formularios

| Propiedad | Valor |
|---|---|
| Altura | 26–32px |
| Background | `#F3F6FA` |
| Borde | `1px solid #D0D5DD` |
| Border-radius | 3px |
| Box-shadow | `0px 0px 0px 1px inset rgba(16,22,26,0.2), 0px -1px 1px 0px inset rgba(16,22,26,0.1)` |
| Focus borde | `#4D71B2` |
| Focus shadow | `0 0 0 3px rgba(77, 113, 178, 0.1)` |

Usar `<FormGroup>` de Blueprint para label + input consistentes.

---

## 7. Iconografía

- Set: Blueprint Icons `@blueprintjs/icons` v6.1.0.
- **No usar** Font Awesome, Material Icons u otros sets.
- Tamaños: 20–24px (navegación) / 16–18px (tablas/botones) / 12–14px (badges) / 10–12px (indicadores).
- Color: heredado del contexto de texto o coloreado por intent.

---

## 8. Gráficas (Recharts)

- Librería: Recharts v3.2.1.
- Container: background `#FFFFFF`, border-radius 8px, shadow `0 1px 3px rgba(0,0,0,0.1)`, padding 16px.
- Altura: 200–300px según tipo.
- Título: 18px weight 600, color `#111418`.
- Subtítulo: 12px weight 400, color `#667085`.
- Tooltip: background `#FFFFFF`, border-radius 6px, shadow `0 2px 8px rgba(0,0,0,0.15)`, padding 8px 12px.
- Leyenda: flex centrado, gap 20px, color box 21px × 8px border-radius 2px, texto Inter 12px weight 400.

---

## 9. Espaciado

| Tamaño | Valor | Uso |
|---|---|---|
| Micro | 4px | Gaps internos de componentes |
| Extra small | 6px | Gaps pequeños |
| Small | 8px | Gaps entre elementos relacionados |
| Regular | 12px | Padding interno, gaps de filas |
| Medium | 16px | Padding de secciones |
| Large | 20px | Gaps entre secciones |
| XL | 24px | Padding de página |
| XXL | 30px | Separación entre secciones grandes |

---

## 10. Arquitectura CSS

- Un archivo `.css` por componente, co-localizado junto al `.tsx`.
- Nomenclatura BEM: `componente-nombre__elemento--modificador`.
- Variables: CSS Custom Properties para colores, espaciado y breakpoints.
- Layout: CSS Grid para páginas y grids de cards / Flexbox para componentes internos.
- Transiciones: `0.2s ease` estándar para hover, focus y transform.
- **No usar:** CSS-in-JS, styled-components, Tailwind CSS. Solo CSS puro con archivos separados.

---

## 11. Barras de Progreso / Capacidad

- Container: background `#E1E8ED`, altura 8px, border-radius 4px.
- Color normal: `#238551` (verde).
- Color crítico: `#CD4246` (rojo).

---

## 12. Search Bar

| Propiedad | Valor |
|---|---|
| Altura | 32px |
| Background | `#F6F7F9` |
| Border-radius | 6px |
| Padding | 4px 6px |
| Borde | `1px solid transparent` |
| Focus borde | `#3182CE` |
| Placeholder | `#7E8697` |
| Font | Inter, 14px |

---

## 13. Z-Index

| Nivel | Valor | Uso |
|---|---|---|
| Sidebar | 1000 | Navegación lateral |
| Header | 1001 | Barra superior |
| Sidebar mobile | 1002 | Sidebar sobre overlay |
| Notification overlay | 9998 | Fondo de notificaciones |
| Notifications / Popovers | 9999 | Panel de notificaciones |
| Filter popovers | 10000 | Popovers de filtros y date pickers |
| Diálogos críticos | 99999 | Modales de confirmación y transacciones |

---

## 14. Accesibilidad

- `aria-label` en todos los botones con solo icono.
- `aria-current="page"` en breadcrumb activo.
- Todas las tablas con `<th>` y scope apropiado.
- Focus visible solo con teclado: `FocusStyleManager.onlyShowFocusOnTabs()`.
- Target touch mínimo: 44px en mobile.
- No depender únicamente del color para comunicar estado — combinar con iconos y texto.

---

## 15. Modo Oscuro

**No soportado.** Light mode únicamente.

```css
color-scheme: light only;
```

Deshabilitar explícitamente clases dark de Blueprint: `.bp4-dark`, `.bp5-dark`, `.bp6-dark`.
