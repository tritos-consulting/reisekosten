// src/TravelExpenseFormDE.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Enthält:
 * - 0,30 €/km (keine Staffel), KM aus Tachostand
 * - Pflichtfelder in Basisdaten (PDF-Button erst aktiv, wenn alles gefüllt)
 * - Drag&Drop + Entfernen-Button für Belege (Bilder & PDFs)
 * - PDF-Anhänge seitenfüllend A4, Bild-Kompression
 * - pdf.js-Lader (zuerst lokal /public/pdfjs, dann CDN-Fallback)
 * - Logo nur auf erster PDF-Seite (rechtsbündig, LOGO_RIGHT justierbar)
 * - Einheitliche, rechtsbündige Betragsspalten in allen Tabellen
 * - „📧 Email “-Button (Light-Variante, mailto:)
 */

// --------- Design Tokens ----------
const TOKENS = {
  radius: 12,
  border: "#E5E7EB",
  bgCard: "#FFFFFF",
  bgApp: "#F8FAFC",
  text: "#0F172A",
  textDim: "#475569",
  textMut: "#64748B",
  primary: "#111827",
  primaryHover: "#0B1220",
  focus: "#2563EB",
};

// --------- Responsive Hook ----------
function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return w;
}
const isTablet = (w) => w >= 768 && w < 1024;
const isDesktop = (w) => w >= 1024;

// --------- Minimal UI primitives ---------
const Card = ({ children }) => (
  <div
    style={{
      border: `1px solid ${TOKENS.border}`,
      borderRadius: TOKENS.radius + 4,
      boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
      overflow: "hidden",
      background: TOKENS.bgCard,
    }}
  >
    {children}
  </div>
);

const CardHeader = ({ children }) => (
  <div
    style={{
      padding: 20,
      borderBottom: `1px solid ${TOKENS.border}`,
      background: "#FAFAFA",
    }}
  >
    {children}
  </div>
);

const CardTitle = ({ children }) => (
  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.2 }}>{children}</div>
);

const CardContent = ({ children }) => (
  <div
    style={{
      paddingInline: 32,   // gleicher Abstand links & rechts
      paddingBlock: 24,    // Abstand oben/unten
      display: "grid",
      gap: 24,
      boxSizing: "border-box",
    }}
  >
    {children}
  </div>
);

const Button = ({ children, onClick, variant = "primary", style, disabled, title, ariaLabel }) => {
  const base = {
    height: 40,
    padding: "0 14px",
    borderRadius: TOKENS.radius,
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: 0.2,
    transition: "all .15s ease",
  };
  const variants = {
    primary: { background: disabled ? "#9CA3AF" : TOKENS.primary, color: "#fff", borderColor: TOKENS.primary },
    secondary: { background: "#FFFFFF", color: TOKENS.text, borderColor: TOKENS.border },
    danger: { background: "#fff", color: "#B91C1C", borderColor: "#FCA5A5" },
    ghost: { background: "rgba(255,255,255,0.9)", color: "#111827", borderColor: "#E5E7EB" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primaryHover;
      }}
      onMouseLeave={(e) => {
        if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primary;
      }}
    >
      {children}
    </button>
  );
};

// Kompakte Inputs
const Input = ({ style, ...props }) => (
  <input
    {...props}
    style={{
      width: "100%",
      height: 34,
      padding: "6px 8px",
      borderRadius: TOKENS.radius,
      border: `1px solid ${TOKENS.border}`,
      outline: "none",
      fontSize: 14,
      transition: "box-shadow .15s ease, border-color .15s ease",
      background: "#FFFFFF",
      ...style,
    }}
    onFocus={(e) => {
      e.currentTarget.style.borderColor = TOKENS.focus;
      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.2)";
    }}
    onBlur={(e) => {
      e.currentTarget.style.borderColor = TOKENS.border;
      e.currentTarget.style.boxShadow = "none";
    }}
  />
);

const Label = ({ children, htmlFor }) => (
  <label
    htmlFor={htmlFor}
    style={{
      display: "block",
      fontSize: 12,
      fontWeight: 600,
      color: TOKENS.textDim,
      marginBottom: 8,
      letterSpacing: 0.2,
    }}
  >
    {children}
  </label>
);

// ---------- Helpers ----------
const fmt = (n) => (Number.isFinite(n) ? n : 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
function kwIsoFromDateStr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7 + 1; // 1..7 (Mo..So)
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  const year = dt.getUTCFullYear();
  return `${week}/${year}`;
}
function kmFlatCost(km, rate = 0.30) {
  const k = Math.max(0, Math.floor(num(km) * 100) / 100);
  return k * rate;
}

// --- Kompression & A4-Export ---
const TARGET_IMG_PX = 1360;     // Zielbreite fürs Downscaling
const JPG_QUALITY_MAIN = 0.78;  // Formular
const JPG_QUALITY_ATTACH = 0.72;// Anhänge

// Logo (liegt in /public/logo.png)
const LOGO_SRC = "logo.png";
const LOGO_W = 180;     // Breite in pt
const LOGO_H = 84;      // Höhe in pt
const LOGO_RIGHT = 24;  // Abstand vom rechten Rand in pt (1 cm ≈ 28.35 pt)

async function downscaleImage(dataUrl, targetWidthPx = TARGET_IMG_PX, quality = JPG_QUALITY_ATTACH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, targetWidthPx / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// --------- pdf.js Loader: lokal, dann CDN ---------
const PDFJS_VERSION = "3.11.174";
const PDFJS_CANDIDATES = [
  { lib: "pdfjs/pdf.min.js", worker: "pdfjs/pdf.worker.min.js" },
  {
    lib: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`,
    worker: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`,
  },
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensurePdfJs() {
  if (window.pdfjsLib) {
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
    }
    return window.pdfjsLib;
  }
  let lastErr;
  for (const c of PDFJS_CANDIDATES) {
    try {
      await loadScript(c.lib);
      if (!window.pdfjsLib) throw new Error("pdfjsLib global missing");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = c.worker;
      return window.pdfjsLib;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(lastErr?.message || "pdf.js konnte nicht geladen werden.");
}

// Summen
const computeSumFahrt = (fahrt) => kmFlatCost(fahrt.km, 0.30) + num(fahrt.oev) + num(fahrt.bahn) + num(fahrt.taxi);
const computeSumVerpf = (v) =>
  Math.max(0, num(v.tage8) * num(v.satz8) + num(v.tage24) * num(v.satz24) - num(v.fruehstueckAbz) * num(v.abzFruehstueck));
const computeSumUebernacht = (u) => num(u.tatsaechlich) + num(u.pauschale);
const computeSumAuslagen = (arr) => (arr || []).reduce((acc, r) => acc + num(r.betrag), 0);

export default function TravelExpenseFormDE() {
  const width = useWindowWidth();

  // ---------- State ----------
  const [basis, setBasis] = useState({
    name: "Kromer Tobias",
    zweck: "",
    beginn: "",
    ende: "",
    kw: "",
    firma: "Tritos Consulting GmbH",
    kwAuto: true,
  });
  const [fahrt, setFahrt] = useState({
    kennzeichen: "",
    tachostandBeginn: "",
    tachostandEnde: "",
    km: "",
    oev: "",
    bahn: "",
    taxi: "",
  });
  const [verpf, setVerpf] = useState({
    tage8: 0,
    tage24: 0,
    fruehstueckAbz: 0,
    satz8: 14,
    satz24: 28,
    abzFruehstueck: 5.6,
  });
  const [uebernacht, setUebernacht] = useState({ tatsaechlich: "", pauschale: "" });
  const [auslagen, setAuslagen] = useState([{ id: 1, text: "", betrag: "" }]);
  // attachments: {kind:"image",name,dataUrl} | {kind:"pdf",name,file}
  const [attachments, setAttachments] = useState([]);
  const [pdfUrl, setPdfUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [testOutput, setTestOutput] = useState([]);
  const printableRef = useRef(null);

  // Drag & Drop UI
  const [isDragging, setIsDragging] = useState(false);
  const dropRef = useRef(null);

  // ---------- Effects ----------
  useEffect(() => {
    if (basis.kwAuto && basis.beginn) {
      const kw = kwIsoFromDateStr(basis.beginn);
      setBasis((b) => ({ ...b, kw }));
    }
  }, [basis.beginn, basis.kwAuto]);

  useEffect(() => {
    const hasBeginn = String(fahrt.tachostandBeginn ?? "") !== "";
    const hasEnde = String(fahrt.tachostandEnde ?? "") !== "";
    if (!hasBeginn || !hasEnde) return;
    const b = num(fahrt.tachostandBeginn);
    const e = num(fahrt.tachostandEnde);
    const diff = Math.max(0, e - b);
    if (String(diff) !== String(fahrt.km)) setFahrt((prev) => ({ ...prev, km: String(diff) }));
  }, [fahrt.tachostandBeginn, fahrt.tachostandEnde]);

  // ---------- Memos ----------
  const kilometergeld = useMemo(() => kmFlatCost(fahrt.km, 0.30), [fahrt.km]);
  const sumFahrt = useMemo(() => computeSumFahrt(fahrt), [fahrt]);
  const sumVerpf = useMemo(() => computeSumVerpf(verpf), [verpf]);
  const sumUebernacht = useMemo(() => computeSumUebernacht(uebernacht), [uebernacht]);
  const sumAuslagen = useMemo(() => computeSumAuslagen(auslagen), [auslagen]);
  const gesamt = useMemo(() => sumFahrt + sumVerpf + sumUebernacht + sumAuslagen, [sumFahrt, sumVerpf, sumUebernacht, sumAuslagen]);

  // Pflichtfelder-Check
  const basisOk = Boolean(basis.name && basis.zweck && basis.beginn && basis.ende && basis.firma);

  // ---------- Handlers ----------
  const addAuslage = () => setAuslagen((a) => [...a, { id: Date.now(), text: "", betrag: "" }]);
  const delAuslage = (id) => setAuslagen((a) => a.filter((x) => x.id !== id));

  const handleFiles = async (filesList) => {
    const files = Array.from(filesList || []);
    const next = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        next.push({ kind: "image", name: file.name, dataUrl });
      } else if (file.type === "application/pdf") {
        next.push({ kind: "pdf", name: file.name, file });
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };

  const handleFileInputChange = async (e) => {
    await handleFiles(e.target.files);
    e.target.value = "";
  };

  const removeAttachment = (idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  // Drag & Drop handlers
  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };
  const onDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  async function renderPdfFileToImages(file) {
    const pdfjsLib = await ensurePdfJs();
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const aspect = vp1.height / vp1.width;
      const targetW = TARGET_IMG_PX;
      const targetH = Math.round(targetW * aspect);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = targetW;
      canvas.height = targetH;

      const scale = targetW / vp1.width;
      const viewport = page.getViewport({ scale });

      await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;

      const dataUrl = canvas.toDataURL("image/jpeg", JPG_QUALITY_ATTACH);
      pages.push({ dataUrl, aspect });
    }
    return pages;
  }

  const generatePDF = async () => {
    setErrMsg("");
    setPdfUrl("");
    try {
      const node = printableRef.current;
      if (!node) return;
      setBusy(true);

      // Temporär offscreen rendern
      const prev = {
        position: node.style.position,
        left: node.style.left,
        top: node.style.top,
        opacity: node.style.opacity,
        pointerEvents: node.style.pointerEvents,
      };
      node.style.position = "absolute";
      node.style.left = "-10000px";
      node.style.top = "0";
      node.style.opacity = "1";
      node.style.pointerEvents = "none";

      // Hauptformular als JPEG (komprimiert)
      const canvas = await html2canvas(node, {
        scale: 1.3,
        useCORS: true,
        backgroundColor: "#ffffff",
        imageTimeout: 15000,
      });

      Object.assign(node.style, prev);

      // Logo laden
      const logoImg = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = LOGO_SRC;
      });

      const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });

      // Hauptseite einpassen (A4 mit Rand)
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const innerW = pageW - margin * 2;
      const innerH = pageH - margin * 2;
      const ratio = Math.min(innerW / canvas.width, innerH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      const imgMain = canvas.toDataURL("image/jpeg", JPG_QUALITY_MAIN);
      pdf.addImage(imgMain, "JPEG", (pageW - w) / 2, margin, w, h, undefined, "FAST");

      // Logo nur auf der ersten Seite, rechtsbündig (LOGO_RIGHT)
      if (logoImg) {
        const x = pageW - LOGO_RIGHT - LOGO_W;
        pdf.addImage(logoImg, "PNG", x, margin, LOGO_W, LOGO_H);
      }

      // ---- Anhänge (A4, 1 pro Seite, Orientierung je Seite) ----
      const allImages = [];
      let pdfRenderFailed = false;

      // 1) Bilder vorbereiten (runterskalieren + komprimieren)
      for (const att of attachments) {
        if (att.kind === "image") {
          try {
            const dataUrl = await downscaleImage(att.dataUrl, TARGET_IMG_PX, JPG_QUALITY_ATTACH);
            allImages.push({ dataUrl, name: att.name });
          } catch (e) {
            console.error("Bildanhang konnte nicht verarbeitet werden:", att.name, e);
          }
        }
      }

      // 2) PDFs rendern -> JPEG-Seiten (komprimiert)
      for (const att of attachments) {
        if (att.kind === "pdf") {
          try {
            const imgs = await renderPdfFileToImages(att.file); // [{dataUrl, aspect}]
            imgs.forEach((img, i) => {
              allImages.push({ dataUrl: img.dataUrl, name: `${att.name} (Seite ${i + 1})`, aspect: img.aspect });
            });
          } catch (err) {
            console.error("PDF-Render-Fehler bei", att.name, err);
            pdfRenderFailed = true;
          }
        }
      }

      // 3) Einfügen: je Bild eine A4-Seite, Orientierung passend (KEIN Logo auf Folgeseiten)
      for (let i = 0; i < allImages.length; i++) {
        const { dataUrl, name } = allImages[i];

        const dim = await new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve({ w: image.width, h: image.height });
          image.src = dataUrl;
        });

        const isLandscape = dim.h / dim.w < 1;
        pdf.addPage("a4", isLandscape ? "landscape" : "portrait");

        const curW = pdf.internal.pageSize.getWidth();
        const curH = pdf.internal.pageSize.getHeight();

        const m = 20;
        const maxW = curW - m * 2;
        const maxH = curH - m * 2;
        const scale = Math.min(maxW / dim.w, maxH / dim.h);
        const drawW = dim.w * scale;
        const drawH = dim.h * scale;

        const x = (curW - drawW) / 2;
        const y = (curH - drawH) / 2;

        pdf.addImage(dataUrl, "JPEG", x, y, drawW, drawH, undefined, "FAST");

        // kein Logo auf den Anhangsseiten
        pdf.setFontSize(9);
        pdf.text(name || "Anhang", m, curH - m / 2);
      }

      // Download + Preview
      const filename = `Reisekosten_${basis.name || "Mitarbeiter"}_KW${(basis.kw || "XX").replace("/", "-")}.pdf`;
      try {
        pdf.save(filename, { returnPromise: true });
      } catch {}
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      if (pdfRenderFailed) setErrMsg("Hinweis: Mindestens ein PDF-Anhang konnte nicht gerendert werden. Bilder wurden dennoch exportiert.");
      else setErrMsg("");

      setBusy(false);
    } catch (err) {
      setBusy(false);
      console.error(err);
      setErrMsg(`PDF-Erzeugung fehlgeschlagen: ${err?.message || err}`);
    }
  };

  // ---------- Tests (optional) ----------
  const runTests = () => {
    const results = [];
    const pass = (name) => results.push({ name, ok: true });
    const fail = (name, msg) => results.push({ name, ok: false, msg });
    try {
      const n1 = num("1,5");
      if (Math.abs(n1 - 1.5) < 1e-9) pass("num parses '1,5'");
      else fail("num parses '1,5'", `got ${n1}`);
      const fahrtTest = { km: 100, oev: 10, bahn: 0, taxi: 0 };
      const sf = computeSumFahrt(fahrtTest);
      if (Math.abs(sf - 40) < 1e-9) pass("computeSumFahrt 0,30 €/km + ÖPNV");
      else fail("computeSumFahrt 0,30 €/km + ÖPNV", `got ${sf}`);
      setTestOutput(results);
    } catch (e) {
      setTestOutput([{ name: "Test runner crashed", ok: false, msg: String(e) }]);
    }
  };

  // ---------- Responsive helpers ----------
  const containerPadding = isDesktop(width) ? 56 : isTablet(width) ? 40 : 24;
  const colGap = isDesktop(width) ? 28 : isTablet(width) ? 24 : 20;
  const cols = (desktop, tablet, mobile) =>
    isDesktop(width) ? `repeat(${desktop}, minmax(0,1fr))` : isTablet(width) ? `repeat(${tablet}, minmax(0,1fr))` : `repeat(${mobile}, minmax(0,1fr))`;

  // ---------- Render ----------
  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        paddingInline: containerPadding, // symmetrisch links & rechts
        paddingBlock: containerPadding,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
        color: TOKENS.text,
        background: TOKENS.bgApp,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reisekostenabrechnung</h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={runTests}>🧪 Tests</Button>

          <Button onClick={generatePDF} disabled={busy || !basisOk}>
            {busy ? "⏳ Erzeuge PDF…" : "⬇️ PDF erzeugen"}
          </Button>

          {/* NEW: Light-Mailto Button */}
          <Button
            variant="secondary"
            onClick={() => {
              const kw = basis.kw || "XX";
              const mailtoLink = `mailto:rechnungswesen@tritos-consutling.com?subject=${encodeURIComponent(
                `Reisekosten KW ${kw}`
              )}&body=${encodeURIComponent("Bitte die PDF-Reisekostenabrechnung im Anhang einfügen.")}`;
              window.location.href = mailtoLink;
            }}
            title="Enail mit Betreff erstellen"
          >
            📧 Email
          </Button>
        </div>
      </div>

      {/* Basisdaten */}
      <Card>
        <CardHeader><CardTitle>Basisdaten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(3, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div>
              <Label htmlFor="name">Name*</Label>
              <Input id="name" required value={basis.name} onChange={(e) => setBasis({ ...basis, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="zweck">Zweck*</Label>
              <Input id="zweck" required placeholder="z.B. Beratung Hallesche" value={basis.zweck} onChange={(e) => setBasis({ ...basis, zweck: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="kw">Kalenderwoche {basis.kwAuto ? "(automatisch)" : "(manuell)"}</Label>
              <Input
                id="kw"
                placeholder="z.B. 27/2025"
                value={basis.kw}
                onChange={(e) => setBasis({ ...basis, kw: e.target.value })}
                disabled={basis.kwAuto}
                style={{ background: basis.kwAuto ? "#F3F4F6" : "#fff" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input
                  id="kwAuto"
                  type="checkbox"
                  checked={basis.kwAuto}
                  onChange={(e) => setBasis({ ...basis, kwAuto: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                <Label htmlFor="kwAuto">KW automatisch aus Beginn-Datum</Label>
              </div>
            </div>
            <div>
              <Label htmlFor="beginn">Beginn*</Label>
              <Input id="beginn" type="date" required value={basis.beginn} onChange={(e) => setBasis({ ...basis, beginn: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ende">Ende*</Label>
              <Input id="ende" type="date" required value={basis.ende} onChange={(e) => setBasis({ ...basis, ende: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="firma">Firma*</Label>
              <Input id="firma" required value={basis.firma} onChange={(e) => setBasis({ ...basis, firma: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fahrtkosten */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Fahrtkosten</CardTitle></CardHeader>
        <CardContent>
          {/* Zeile 1 */}
          <div style={{ display: "grid", gridTemplateColumns: cols(5, 3, 1), columnGap: colGap, rowGap: 24 }}>
            <div>
              <Label>Privat-PKW Kennzeichen</Label>
              <Input placeholder="z.B. S-AB 1234" value={fahrt.kennzeichen} onChange={(e) => setFahrt({ ...fahrt, kennzeichen: e.target.value })} />
            </div>
            <div>
              <Label>Tachostand Beginn</Label>
              <Input inputMode="decimal" placeholder="z.B. 25 300,0" value={fahrt.tachostandBeginn} onChange={(e) => setFahrt({ ...fahrt, tachostandBeginn: e.target.value })} />
            </div>
            <div>
              <Label>Tachostand Ende</Label>
              <Input inputMode="decimal" placeholder="z.B. 25 420,5" value={fahrt.tachostandEnde} onChange={(e) => setFahrt({ ...fahrt, tachostandEnde: e.target.value })} />
            </div>
            <div>
              <Label>KM Gesamt</Label>
              <Input inputMode="decimal" placeholder="auto aus Tachostand" value={fahrt.km} onChange={(e) => setFahrt({ ...fahrt, km: e.target.value })} />
            </div>
            <div>
              <Label>Kilometergeld (0,30 €/km)</Label>
              <Input readOnly value={fmt(kilometergeld)} style={{ background: "#F3F4F6" }} />
            </div>
          </div>

          {/* Zeile 2 */}
          <div style={{ display: "grid", gridTemplateColumns: cols(3, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div>
              <Label>Deutsche Bahn</Label>
              <Input inputMode="decimal" placeholder="0,00" value={fahrt.bahn} onChange={(e) => setFahrt({ ...fahrt, bahn: e.target.value })} />
            </div>
            <div>
              <Label>Taxi</Label>
              <Input inputMode="decimal" placeholder="0,00" value={fahrt.taxi} onChange={(e) => setFahrt({ ...fahrt, taxi: e.target.value })} />
            </div>
            <div>
              <Label>Öffentliche Verkehrsmittel (gesamt)</Label>
              <Input inputMode="decimal" placeholder="0,00" value={fahrt.oev} onChange={(e) => setFahrt({ ...fahrt, oev: e.target.value })} />
            </div>
          </div>

          <div style={{ fontSize: 12, color: TOKENS.textMut }}>
            Zwischensumme Fahrtkosten: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumFahrt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Verpflegungsmehraufwand */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Verpflegungsmehraufwand</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div>
              <Label>Tage &gt; 8 Std.</Label>
              <Input inputMode="numeric" value={verpf.tage8} onChange={(e) => setVerpf({ ...verpf, tage8: e.target.value })} />
            </div>
            <div>
              <Label>Satz (€/Tag)</Label>
              <Input inputMode="decimal" value={verpf.satz8} onChange={(e) => setVerpf({ ...verpf, satz8: e.target.value })} />
            </div>
            <div>
              <Label>Tage 24 Std.</Label>
              <Input inputMode="numeric" value={verpf.tage24} onChange={(e) => setVerpf({ ...verpf, tage24: e.target.value })} />
            </div>
            <div>
              <Label>Satz (€/Tag)</Label>
              <Input inputMode="decimal" value={verpf.satz24} onChange={(e) => setVerpf({ ...verpf, satz24: e.target.value })} />
            </div>
            <div>
              <Label>abzgl. Frühstück (Anzahl)</Label>
              <Input inputMode="numeric" value={verpf.fruehstueckAbz} onChange={(e) => setVerpf({ ...verpf, fruehstueckAbz: e.target.value })} />
            </div>
            <div>
              <Label>Abzug pro Frühstück (€)</Label>
              <Input inputMode="decimal" value={verpf.abzFruehstueck} onChange={(e) => setVerpf({ ...verpf, abzFruehstueck: e.target.value })} />
            </div>
          </div>

          <div style={{ fontSize: 12, color: TOKENS.textMut }}>
            Zwischensumme: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumVerpf)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Übernachtungskosten */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Übernachtungskosten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div>
              <Label>Tatsächliche Kosten (ohne Verpflegung)</Label>
              <Input inputMode="decimal" value={uebernacht.tatsaechlich} onChange={(e) => setUebernacht({ ...uebernacht, tatsaechlich: e.target.value })} />
            </div>
            <div>
              <Label>Pauschale</Label>
              <Input inputMode="decimal" value={uebernacht.pauschale} onChange={(e) => setUebernacht({ ...uebernacht, pauschale: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: TOKENS.textMut }}>
            Zwischensumme: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumUebernacht)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Sonstige Auslagen */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <CardTitle>Sonstige Auslagen</CardTitle>
            <Button variant="secondary" onClick={addAuslage}>+ Position</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: 24 }}>
            {auslagen.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: cols(6, 3, 1), columnGap: colGap, rowGap: 24 }}>
                <div style={{ gridColumn: isDesktop(width) ? "span 4" : isTablet(width) ? "span 2" : "span 1" }}>
                  <Label>Bezeichnung</Label>
                  <Input
                    placeholder="z.B. Smart Charge"
                    value={r.text}
                    onChange={(e) =>
                      setAuslagen((a) => a.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))
                    }
                  />
                </div>
                <div style={{ gridColumn: isDesktop(width) ? "span 2" : "span 1" }}>
                  <Label>Betrag (€)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={r.betrag}
                    onChange={(e) =>
                      setAuslagen((a) => a.map((x) => (x.id === r.id ? { ...x, betrag: e.target.value } : x)))
                    }
                  />
                </div>
                {auslagen.length > 1 && (
                  <div style={{ gridColumn: "1 / -1", marginTop: -4 }}>
                    <Button variant="secondary" onClick={() => delAuslage(r.id)}>Entfernen</Button>
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 12, color: TOKENS.textMut }}>
              Zwischensumme: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumAuslagen)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Belege (Upload + Drag&Drop) */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Belege hochladen</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Input
              id="file"
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={handleFileInputChange}
              style={{ maxWidth: 480 }}
            />
            <div style={{ fontSize: 12, color: TOKENS.textMut }}>
              Bilder & PDFs werden komprimiert und jeweils seitenfüllend auf DIN A4 angehängt.
            </div>
          </div>

          {/* Drag & Drop Zone */}
          <div
            ref={dropRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{
              marginTop: 8,
              border: `2px dashed ${isDragging ? TOKENS.focus : TOKENS.border}`,
              background: isDragging ? "rgba(37,99,235,0.06)" : "#fff",
              borderRadius: TOKENS.radius,
              padding: 24,
              textAlign: "center",
              color: TOKENS.textDim,
              transition: "all .15s ease",
            }}
          >
            {isDragging ? "Dateien hierher loslassen…" : "…oder Dateien hierher ziehen und ablegen (Bilder, PDFs)"}
          </div>

          {attachments.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: cols(4, 3, 2), columnGap: colGap, rowGap: 24 }}>
              {attachments.map((att, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${TOKENS.border}`,
                    borderRadius: TOKENS.radius,
                    padding: 10,
                    display: "grid",
                    alignItems: "center",
                    justifyItems: "center",
                    gridTemplateRows: "1fr",
                    aspectRatio: "1 / 1",
                    overflow: "hidden",
                    position: "relative",
                    background: "#fff",
                  }}
                >
                  {/* Entfernen-Overlay */}
                  <Button
                    variant="ghost"
                    onClick={() => removeAttachment(i)}
                    title="Beleg entfernen"
                    ariaLabel={`Anhang ${att.name} entfernen`}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      height: 30,
                      padding: "0 10px",
                      borderRadius: 10,
                      backdropFilter: "blur(2px)",
                    }}
                  >
                    Entfernen ✕
                  </Button>

                  {att.kind === "image" ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      style={{
                        objectFit: "contain",
                        maxWidth: "100%",
                        maxHeight: "100%",
                        width: "auto",
                        height: "auto",
                        placeSelf: "center",
                      }}
                    />
                  ) : (
                    <div style={{ textAlign: "center", fontSize: 12, color: TOKENS.textDim, padding: 8, placeSelf: "center" }}>
                      📄
                      <div style={{ marginTop: 6, wordBreak: "break-word" }}>{att.name}</div>
                      <div style={{ marginTop: 6, fontSize: 11, color: TOKENS.textMut }}>PDF wird beim Export gerendert</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Gesamtsumme</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(gesamt)}</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Button onClick={generatePDF} disabled={busy || !basisOk}>
                {busy ? "⏳ Erzeuge PDF…" : "⬇️ PDF erzeugen"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const kw = basis.kw || "XX";
                  const mailtoLink = `mailto:rechnungswesen@tritos-consutling.com?subject=${encodeURIComponent(
                    `Reisekosten KW ${kw}`
                  )}&body=${encodeURIComponent("Bitte die PDF-Reisekostenabrechnung im Anhang einfügen.")}`;
                  window.location.href = mailtoLink;
                }}
              >
                📧 Email 
              </Button>
              {pdfUrl && (
                <>
                  <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontSize: 14 }}>Vorschau öffnen</a>
                  <a href={pdfUrl} download={`Reisekosten_${basis.name || "Mitarbeiter"}_KW${(basis.kw || "XX").replace("/", "-")}.pdf`} style={{ textDecoration: "none", fontSize: 14 }}>PDF herunterladen</a>
                </>
              )}
            </div>
          </div>
          {errMsg && <div style={{ marginTop: 8, color: "#DC2626" }}>{errMsg}</div>}
        </CardContent>
      </Card>

      {/* Printable area (für PDF-Screenshot) */}
      <div
        ref={printableRef}
        style={{
          width: 794,
          padding: 24,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
          backgroundColor: "#ffffff",
          color: "#000000",
          lineHeight: 1.35,
          marginTop: 24,
        }}
      >
        {/* Kopfbereich – Logo NICHT rendern (damit es nicht doppelt im PDF landet) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12 }}>{basis.firma}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>Reisekostenabrechnung</div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {basis.kw ? `KW ${basis.kw}` : null}
              {basis.kw && (basis.name || basis.beginn || basis.ende) ? " – " : null}
              {basis.name}
            </div>
          </div>
          <div style={{ width: 90, height: 28 }} />
        </div>

        {/* Basisdaten PDF */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 16, fontSize: 12 }}>
          <div>
            <div><span style={{ fontWeight: 600 }}>Name:</span> {basis.name}</div>
            <div><span style={{ fontWeight: 600 }}>Zweck:</span> {basis.zweck}</div>
          </div>
          <div>
            <div><span style={{ fontWeight: 600 }}>Beginn:</span> {basis.beginn}</div>
            <div><span style={{ fontWeight: 600 }}>Ende:</span> {basis.ende}</div>
          </div>
        </div>

        {/* Tabellen – 5-Spalten-Raster, letzte Spalte = Beträge (rechtsbündig, fixe Breite) */}
        {(() => {
          const cell = { border: "1px solid #000", padding: 8, fontSize: 12, verticalAlign: "top" };
          const header = { fontWeight: 700, marginTop: 16 };
          const amtCell = { ...cell, textAlign: "right", width: 110 };
          const textCell = { ...cell };

          const km = num(fahrt.km);
          const kmCost = kmFlatCost(km, 0.30);

          return (
            <>
              {/* Fahrtkosten */}
              <div style={header}>Fahrtkosten</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup>
                  <col /><col /><col /><col />
                  <col style={{ width: 110 }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td style={textCell}>Privat-PKW</td>
                    <td style={textCell}>Kennzeichen: {fahrt.kennzeichen || "—"}</td>
                    <td style={textCell}>Tachostand: {fahrt.tachostandBeginn || "—"} → {fahrt.tachostandEnde || "—"}</td>
                    <td style={textCell}>{km} km × 0,30 €/km</td>
                    <td style={amtCell}>{fmt(kmCost)}</td>
                  </tr>
                  <tr>
                    <td style={textCell}>Deutsche Bahn</td>
                    <td style={textCell} colSpan={3}></td>
                    <td style={amtCell}>{fmt(num(fahrt.bahn))}</td>
                  </tr>
                  <tr>
                    <td style={textCell}>Taxi</td>
                    <td style={textCell} colSpan={3}></td>
                    <td style={amtCell}>{fmt(num(fahrt.taxi))}</td>
                  </tr>
                  <tr>
                    <td style={textCell}>Öffentliche Verkehrsmittel</td>
                    <td style={textCell} colSpan={3}></td>
                    <td style={amtCell}>{fmt(num(fahrt.oev))}</td>
                  </tr>
                  <tr>
                    <td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme Fahrtkosten</td>
                    <td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumFahrt)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Verpflegung */}
              <div style={header}>Verpflegungsmehraufwand</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup>
                  <col /><col /><col /><col />
                  <col style={{ width: 110 }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td style={textCell}>Tage &gt; 8 Std.</td>
                    <td style={textCell}>{verpf.tage8}</td>
                    <td style={textCell}>Satz {fmt(num(verpf.satz8))}</td>
                    <td style={textCell}></td>
                    <td style={amtCell}>{fmt(num(verpf.tage8) * num(verpf.satz8))}</td>
                  </tr>
                  <tr>
                    <td style={textCell}>Tage 24 Std.</td>
                    <td style={textCell}>{verpf.tage24}</td>
                    <td style={textCell}>Satz {fmt(num(verpf.satz24))}</td>
                    <td style={textCell}></td>
                    <td style={amtCell}>{fmt(num(verpf.tage24) * num(verpf.satz24))}</td>
                  </tr>
                  <tr>
                    <td style={textCell}>abzgl. Frühstück</td>
                    <td style={textCell}>{verpf.fruehstueckAbz}</td>
                    <td style={textCell}>{fmt(num(verpf.abzFruehstueck))} pro Frühstück</td>
                    <td style={textCell}></td>
                    <td style={amtCell}>- {fmt(num(verpf.fruehstueckAbz) * num(verpf.abzFruehstueck))}</td>
                  </tr>
                  <tr>
                    <td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme</td>
                    <td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumVerpf)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Übernachtung */}
              <div style={header}>Übernachtungskosten</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup>
                  <col /><col /><col /><col />
                  <col style={{ width: 110 }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td style={textCell}>Tatsächliche Kosten (ohne Verpflegung)</td>
                    <td style={textCell} colSpan={3}></td>
                    <td style={amtCell}>{fmt(num(uebernacht.tatsaechlich))}</td>
                  </tr>
                  <tr>
                    <td style={textCell}>Pauschale</td>
                    <td style={textCell} colSpan={3}></td>
                    <td style={amtCell}>{fmt(num(uebernacht.pauschale))}</td>
                  </tr>
                  <tr>
                    <td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme</td>
                    <td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumUebernacht)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Auslagen */}
              <div style={header}>Sonstige Auslagen</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup>
                  <col /><col /><col /><col />
                  <col style={{ width: 110 }} />
                </colgroup>
                <tbody>
                  {auslagen.map((r, i) => (
                    <tr key={i}>
                      <td style={textCell} colSpan={4}>{r.text || "—"}</td>
                      <td style={amtCell}>{fmt(num(r.betrag))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme</td>
                    <td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumAuslagen)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ textAlign: "right", marginTop: 16, fontWeight: 700, fontSize: 14 }}>
                Gesamte Reisekosten: {fmt(gesamt)}
              </div>
            </>
          );
        })()}
      </div>

      {/* Hinweis */}
      <div style={{ fontSize: 12, color: TOKENS.textMut, marginTop: 8 }}>
        📷 Tipp: Bilder & PDFs hier hochladen – sie landen automatisch (komprimiert) in der Export-PDF. Du kannst Dateien auch in das Feld ziehen.
      </div>

      {/* Test results */}
      {testOutput.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card>
            <CardHeader><CardTitle>Testergebnisse</CardTitle></CardHeader>
            <CardContent>
              <ul style={{ display: "grid", gap: 6, fontSize: 14, margin: 0, paddingLeft: 16 }}>
                {testOutput.map((t, i) => (
                  <li key={i} style={{ color: t.ok ? "#059669" : "#DC2626" }}>
                    {t.ok ? "✔" : "✖"} {t.name} {t.msg ? `– ${t.msg}` : ""}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
