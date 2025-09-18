// src/TravelExpenseFormDE.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Features (Kurz):
 * - Pflichtfelder in Basisdaten
 * - KW automatisch aus Beginn (optional)
 * - KM automatisch aus Tachostand
 * - Fahrtkosten 0,30 €/km
 * - Verpflegungsmehraufwand mit ausklappbaren Abzügen (Frühstück/Mittag/Abend)
 * - Sonstige Auslagen (dynamisch)
 * - Belege: Bilder & PDFs, Drag&Drop, Entfernen
 * - PDF: Deckblatt-Screenshot + Logo auf Seite 1, Anhänge seitenfüllend
 * - Komprimierte Bilder für kleine PDF-Dateien
 * - DATEV: sichtbare Angaben auf Seite 1 + PDF-Properties
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

// --------- Minimal UI ----------
const Card = ({ children }) => (
  <div style={{ border: `1px solid ${TOKENS.border}`, borderRadius: TOKENS.radius + 4, boxShadow: "0 8px 24px rgba(15,23,42,0.06)", overflow: "hidden", background: TOKENS.bgCard }}>
    {children}
  </div>
);
const CardHeader = ({ children }) => <div style={{ padding: 20, borderBottom: `1px solid ${TOKENS.border}`, background: "#FAFAFA" }}>{children}</div>;
const CardTitle = ({ children }) => <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>;
const CardContent = ({ children }) => <div style={{ paddingInline: 32, paddingBlock: 24, display: "grid", gap: 24 }}>{children}</div>;
const Button = ({ children, onClick, variant = "primary", style, disabled, title, ariaLabel }) => {
  const base = { height: 40, padding: "0 14px", borderRadius: TOKENS.radius, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, transition: "all .15s ease" };
  const variants = {
    primary: { background: disabled ? "#9CA3AF" : TOKENS.primary, color: "#fff", borderColor: TOKENS.primary },
    secondary: { background: "#FFFFFF", color: TOKENS.text, borderColor: TOKENS.border },
    ghost: { background: "rgba(255,255,255,0.9)", color: "#111827", borderColor: "#E5E7EB" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => { if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primaryHover; }}
      onMouseLeave={(e) => { if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primary; }}
    >
      {children}
    </button>
  );
};
const Input = ({ style, ...props }) => (
  <input
    {...props}
    style={{ width: "100%", height: 34, padding: "6px 8px", borderRadius: TOKENS.radius, border: `1px solid ${TOKENS.border}`, outline: "none", fontSize: 14, background: "#FFFFFF", ...style }}
  />
);
const Label = ({ children, htmlFor }) => <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, fontWeight: 600, color: TOKENS.textDim, marginBottom: 8 }}>{children}</label>;

// ---------- Helpers ----------
const fmt = (n) => (Number.isFinite(n) ? n : 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
function kwIsoFromDateStr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7 + 1;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  const year = dt.getUTCFullYear();
  return `${week}/${year}`;
}
function kmFlatCost(km, rate = 0.30) { return Math.max(0, num(km)) * rate; }

// Datum & Namen für DATEV
function formatDateDE(d = new Date()) {
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
/** Eingabe: "Vorname Nachname" -> Ausgabe: "Nachname, Vorname"; bei einem Wort: dieses Wort */
function toLastNameFirst(fullName) {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0];
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  return `${last}, ${first}`;
}

// --- Kompression ---
const TARGET_IMG_PX = 1360;
const JPG_QUALITY_MAIN = 0.78;
const JPG_QUALITY_ATTACH = 0.72;

// Logo (optional, in /public/logo.png)
const LOGO_SRC = "logo.png";
const LOGO_W = 180; // pt
const LOGO_H = 84;  // pt
const LOGO_RIGHT = 24; // pt

// pdf.js Loader (lokal -> CDN)
const PDFJS_VERSION = "3.11.174";
const PDFJS_CANDIDATES = [
  { lib: "pdfjs/pdf.min.js", worker: "pdfjs/pdf.worker.min.js" },
  { lib: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`, worker: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js` },
];
function loadScript(src) { return new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = src; s.async = true; s.crossOrigin = "anonymous"; s.onload = () => resolve(true); s.onerror = () => reject(new Error(`Script load failed: ${src}`)); document.head.appendChild(s); }); }
async function ensurePdfJs() {
  if (window.pdfjsLib) {
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
    return window.pdfjsLib;
  }
  let lastErr;
  for (const c of PDFJS_CANDIDATES) {
    try {
      await loadScript(c.lib);
      if (!window.pdfjsLib) throw new Error("pdfjsLib global missing");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = c.worker;
      return window.pdfjsLib;
    } catch (e) { lastErr = e; }
  }
  throw new Error(lastErr?.message || "pdf.js konnte nicht geladen werden.");
}
async function downscaleImage(dataUrl, targetWidthPx = TARGET_IMG_PX, quality = JPG_QUALITY_ATTACH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, targetWidthPx / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// Summen
const computeSumFahrt = (fahrt) => kmFlatCost(fahrt.km, 0.30) + num(fahrt.oev) + num(fahrt.bahn) + num(fahrt.taxi);
const computeSumVerpf = (v) =>
  Math.max(
    0,
    num(v.tage8) * num(v.satz8) +
      num(v.tage24) * num(v.satz24) -
      num(v.fruehstueckAbz) * num(v.abzFruehstueck) -
      num(v.mittagAbz) * num(v.abzMittag) -
      num(v.abendAbz) * num(v.abzAbend)
  );
const computeSumUebernacht = (u) => num(u.tatsaechlich) + num(u.pauschale);
const computeSumAuslagen = (arr) => (arr || []).reduce((acc, r) => acc + num(r.betrag), 0);

// ------- Component -------
export default function TravelExpenseFormDE() {
  const width = useWindowWidth();

  // Basis
  const [basis, setBasis] = useState({
    name: "",
    zweck: "",
    beginn: "",
    ende: "",
    kw: "",
    firma: "Tritos Consulting GmbH",
    kwAuto: true,
  });

  // Fahrt
  const [fahrt, setFahrt] = useState({
    kennzeichen: "",
    tachostandBeginn: "",
    tachostandEnde: "",
    km: "",
    oev: "",
    bahn: "",
    taxi: "",
  });

  // Verpflegung (+ ausklappbare Abzüge)
  const [verpf, setVerpf] = useState({
    tage8: 0,
    tage24: 0,
    fruehstueckAbz: 0,
    mittagAbz: 0,
    abendAbz: 0,
    satz8: 14,
    satz24: 28,
    abzFruehstueck: 5.6,
    abzMittag: 11.2,
    abzAbend: 11.2,
  });
  const [showDeductions, setShowDeductions] = useState(false);

  // Übernachtung
  const [uebernacht, setUebernacht] = useState({ tatsaechlich: "", pauschale: "" });

  // Auslagen
  const [auslagen, setAuslagen] = useState([{ id: 1, text: "", betrag: "" }]);

  // Anhänge
  const [attachments, setAttachments] = useState([]); // {kind:'image'|'pdf', name, dataUrl?|file?}
  const [pdfUrl, setPdfUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [testOutput, setTestOutput] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  const dropRef = useRef(null);
  const printableRef = useRef(null);

  // Effects
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

  // Memo totals
  const kilometergeld = useMemo(() => kmFlatCost(fahrt.km, 0.30), [fahrt.km]);
  const sumFahrt = useMemo(() => computeSumFahrt(fahrt), [fahrt]);
  const sumVerpf = useMemo(() => computeSumVerpf(verpf), [verpf]);
  const sumUebernacht = useMemo(() => computeSumUebernacht(uebernacht), [uebernacht]);
  const sumAuslagen = useMemo(() => computeSumAuslagen(auslagen), [auslagen]);
  const gesamt = useMemo(() => sumFahrt + sumVerpf + sumUebernacht + sumAuslagen, [sumFahrt, sumVerpf, sumUebernacht, sumAuslagen]);

  const basisOk = Boolean(basis.name && basis.zweck && basis.beginn && basis.ende && basis.firma);

  // Handlers
  const addAuslage = () => setAuslagen((a) => [...a, { id: Date.now(), text: "", betrag: "" }]);
  const delAuslage = (id) => setAuslagen((a) => a.filter((x) => x.id !== id));

  const handleFiles = async (filesList) => {
    const files = Array.from(filesList || []);
    const next = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
        next.push({ kind: "image", name: file.name, dataUrl });
      } else if (file.type === "application/pdf") {
        next.push({ kind: "pdf", name: file.name, file });
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };
  const handleFileInputChange = async (e) => { await handleFiles(e.target.files); e.target.value = ""; };
  const removeAttachment = (idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); if (dropRef.current && !dropRef.current.contains(e.relatedTarget)) setIsDragging(false); };
  const onDrop = async (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files); };

  // Tests (Kurz)
  const runTests = () => {
    const results = [];
    const pass = (name) => results.push({ name, ok: true });
    const fail = (name, msg) => results.push({ name, ok: false, msg });
    try {
      const n1 = num("1,5"); Math.abs(n1 - 1.5) < 1e-9 ? pass("num('1,5')") : fail("num('1,5')", n1);
      const sf = computeSumFahrt({ km: 100, oev: 10, bahn: 0, taxi: 0 }); Math.abs(sf - 40) < 1e-9 ? pass("Fahrt 100km + 10€") : fail("Fahrt", sf);
      setTestOutput(results);
    } catch (e) {
      setTestOutput([{ name: "Test runner crashed", ok: false, msg: String(e) }]);
    }
  };

  // Layout helpers
  const containerPadding = isDesktop(width) ? 56 : isTablet(width) ? 40 : 24;
  const colGap = isDesktop(width) ? 28 : isTablet(width) ? 24 : 20;
  const cols = (d, t, m) => (isDesktop(width) ? `repeat(${d}, minmax(0,1fr))` : isTablet(width) ? `repeat(${t}, minmax(0,1fr))` : `repeat(${m}, minmax(0,1fr))`);

  // ------- DATEV Stempel/Properties (nur Seite 1) -------
  function applyDatevMetadata(pdf, title, amountNumber, partnerLastFirst, invoiceDateDE) {
    try {
      pdf.setProperties({
        title,
        subject: title,
        author: basis.name || "",
        keywords: `DATEV;Reisekosten;Rechnungsbetrag=${(Number(amountNumber||0)).toFixed(2)}`,
        creator: "Reisekosten Webformular",
      });
      if (pdf.setCreationDate) pdf.setCreationDate(new Date());
    } catch {}
  }

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
      const scale = targetW / vp1.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = Math.round(targetW * aspect);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise;
      pages.push({ dataUrl: canvas.toDataURL("image/jpeg", JPG_QUALITY_ATTACH), aspect });
    }
    return pages;
  }

  // ------- PDF-Erzeugung (Metadaten unten, klein & grau) -------
  const generatePDF = async () => {
    setErrMsg("");
    setPdfUrl("");
    try {
      const node = printableRef.current;
      if (!node) return;
      setBusy(true);

      // Offscreen rendern für html2canvas
      const prev = { position: node.style.position, left: node.style.left, top: node.style.top, opacity: node.style.opacity, pointerEvents: node.style.pointerEvents };
      node.style.position = "absolute"; node.style.left = "-10000px"; node.style.top = "0"; node.style.opacity = "1"; node.style.pointerEvents = "none";

      const canvas = await html2canvas(node, { scale: 1.3, useCORS: true, backgroundColor: "#ffffff", imageTimeout: 15000 });
      Object.assign(node.style, prev);

      // Logo laden (optional)
      const logoImg = await new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = LOGO_SRC; });

      const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;

      // Sichtbare Metadaten (nur 2 Zeilen) -> unten, klein, grau
      const invoiceDate = formatDateDE(new Date());
      const amountStr = fmt(gesamt);

      const metaFontSize = 9;     // klein
      const metaLine = 12;        // kleinere Schrittgröße (Zeilenabstand)
      const metaColorGray = 130;  // hellgrau
      const metaLines = [
        `Rechnungsbetrag: ${amountStr}`,
        `Rechnungsdatum: ${invoiceDate}`,
      ];
      const metaBlockHeight = metaLine * metaLines.length;

      // Logo oben rechts (optional)
      if (logoImg) {
        const x = pageW - LOGO_RIGHT - LOGO_W;
        pdf.addImage(logoImg, "PNG", x, margin, LOGO_W, LOGO_H);
      }

      // Hauptformular-Bild: Platz bis knapp über Metablock; wenn Logo vorhanden, unter Logo einsteigen
      const topOffset = logoImg ? LOGO_H + 10 : 0; // Kollisionsvermeidung mit Logo
      const availableTop = margin + topOffset;
      const availableBottom = pageH - margin - metaBlockHeight - 6; // kleiner Abstand über Metablock
      const availableH = Math.max(0, availableBottom - availableTop);

      const imgMain = canvas.toDataURL("image/jpeg", JPG_QUALITY_MAIN);
      const innerW = pageW - margin * 2;
      const ratio = Math.min(innerW / canvas.width, availableH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      const imgX = (pageW - w) / 2;
      const imgY = availableTop;

      pdf.addImage(imgMain, "JPEG", imgX, imgY, w, h, undefined, "FAST");

      // Metablock unten links
      pdf.setFontSize(metaFontSize);
      pdf.setTextColor(metaColorGray);
      let y = pageH - margin - metaBlockHeight + metaFontSize;
      for (const line of metaLines) {
        pdf.text(line, margin, y);
        y += metaLine;
      }

      // Unsichtbare PDF-Properties (weiterhin gesetzt)
      const docTitle = `Reisekosten ${basis.name || "Mitarbeiter"} ${String(basis.kw || "XX").replace("/", "-")}`;
      const partner = toLastNameFirst(basis.name);
      applyDatevMetadata(pdf, docTitle, gesamt, partner, invoiceDate);

      // ---- Anhänge (ein Bild/Seite oder PDF-Seite/Seite) ----
      const allImages = [];
      let pdfRenderFailed = false;

      // Bilder
      for (const att of attachments) {
        if (att.kind === "image") {
          try {
            const small = await downscaleImage(att.dataUrl, TARGET_IMG_PX, JPG_QUALITY_ATTACH);
            allImages.push({ dataUrl: small, name: att.name });
          } catch (e) { console.error("Bildanhang Fehler:", att.name, e); }
        }
      }
      // PDFs
      for (const att of attachments) {
        if (att.kind === "pdf") {
          try {
            const imgs = await renderPdfFileToImages(att.file);
            imgs.forEach((img, i) => allImages.push({ dataUrl: img.dataUrl, name: `${att.name} (Seite ${i + 1})` }));
          } catch (e) { console.error("PDF-Render-Fehler:", att.name, e); pdfRenderFailed = true; }
        }
      }

      // Einfügen der Anhänge (ab Seite 2)
      for (const { dataUrl, name } of allImages) {
        const dim = await new Promise((resolve) => { const image = new Image(); image.onload = () => resolve({ w: image.width, h: image.height }); image.src = dataUrl; });
        const isLandscape = dim.h / dim.w < 1;
        pdf.addPage("a4", isLandscape ? "landscape" : "portrait");
        const curW = pdf.internal.pageSize.getWidth();
        const curH = pdf.internal.pageSize.getHeight();
        const m = 20;
        const maxW = curW - m * 2;
        const maxH = curH - m * 2;
        const s = Math.min(maxW / dim.w, maxH / dim.h);
        const drawW = dim.w * s;
        const drawH = dim.h * s;
        const x = (curW - drawW) / 2;
        const y2 = (curH - drawH) / 2;
        pdf.addImage(dataUrl, "JPEG", x, y2, drawW, drawH, undefined, "FAST");

        pdf.setFontSize(9);
        pdf.setTextColor(90);
        pdf.text(name || "Anhang", m, curH - m / 2);
      }

      const filename = `Reisekosten_${basis.name || "Mitarbeiter"}_KW${(basis.kw || "XX").replace("/", "-")}.pdf`;
      try { pdf.save(filename, { returnPromise: true }); } catch {}
      const blob = pdf.output("blob");
      setPdfUrl(URL.createObjectURL(blob));
      if (pdfRenderFailed) setErrMsg("Hinweis: Mindestens ein PDF-Anhang konnte nicht gerendert werden. Bilder wurden dennoch exportiert.");
      setBusy(false);
    } catch (err) {
      setBusy(false);
      console.error(err);
      setErrMsg(`PDF-Erzeugung fehlgeschlagen: ${err?.message || err}`);
    }
  };

  // ---------- Render ----------
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", paddingInline: containerPadding, paddingBlock: containerPadding, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"', color: TOKENS.text, background: TOKENS.bgApp }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reisekostenabrechnung</h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={runTests}>🧪 Tests</Button>
          <Button onClick={generatePDF} disabled={busy || !basisOk}>{busy ? "⏳ Erzeuge PDF…" : "⬇️ PDF erzeugen"}</Button>
          <Button variant="secondary" onClick={() => {
            const kw = basis.kw || "XX";
            const mailto = `mailto:rechnungswesen@tritos-consulting.com?subject=${encodeURIComponent(`Reisekosten KW ${kw}`)}&body=${encodeURIComponent("Bitte die PDF-Reisekostenabrechnung im Anhang einfügen.")}`;
            window.location.href = mailto;
          }}>📧 Email</Button>
          {pdfUrl && (
            <>
              <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontSize: 14 }}>Vorschau öffnen</a>
              <a href={pdfUrl} download={`Reisekosten_${basis.name || "Mitarbeiter"}_KW${(basis.kw || "XX").replace("/", "-")}.pdf`} style={{ textDecoration: "none", fontSize: 14 }}>PDF herunterladen</a>
            </>
          )}
        </div>
      </div>

      {/* Basisdaten */}
      <Card>
        <CardHeader><CardTitle>Basisdaten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(3, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label htmlFor="name">Name*</Label><Input id="name" required value={basis.name} onChange={(e) => setBasis({ ...basis, name: e.target.value })} /></div>
            <div><Label htmlFor="zweck">Zweck*</Label><Input id="zweck" required placeholder="z.B. Beratung Hallesche" value={basis.zweck} onChange={(e) => setBasis({ ...basis, zweck: e.target.value })} /></div>
            <div>
              <Label htmlFor="kw">Kalenderwoche {basis.kwAuto ? "(automatisch)" : "(manuell)"}</Label>
              <Input id="kw" placeholder="z.B. 27/2025" value={basis.kw} onChange={(e) => setBasis({ ...basis, kw: e.target.value })} disabled={basis.kwAuto} style={{ background: basis.kwAuto ? "#F3F4F6" : "#fff" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input id="kwAuto" type="checkbox" checked={basis.kwAuto} onChange={(e) => setBasis({ ...basis, kwAuto: e.target.checked })} style={{ width: 16, height: 16 }} />
                <Label htmlFor="kwAuto">KW automatisch aus Beginn-Datum</Label>
              </div>
            </div>
            <div><Label htmlFor="beginn">Beginn*</Label><Input id="beginn" type="date" required value={basis.beginn} onChange={(e) => setBasis({ ...basis, beginn: e.target.value })} /></div>
            <div><Label htmlFor="ende">Ende*</Label><Input id="ende" type="date" required value={basis.ende} onChange={(e) => setBasis({ ...basis, ende: e.target.value })} /></div>
            <div><Label htmlFor="firma">Firma*</Label><Input id="firma" required value={basis.firma} onChange={(e) => setBasis({ ...basis, firma: e.target.value })} /></div>
          </div>
        </CardContent>
      </Card>

      {/* Fahrtkosten */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Fahrtkosten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(5, 3, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label>Privat-PKW Kennzeichen</Label><Input placeholder="z.B. S-AB 1234" value={fahrt.kennzeichen} onChange={(e) => setFahrt({ ...fahrt, kennzeichen: e.target.value })} /></div>
            <div><Label>Tachostand Beginn</Label><Input inputMode="decimal" placeholder="z.B. 25300,0" value={fahrt.tachostandBeginn} onChange={(e) => setFahrt({ ...fahrt, tachostandBeginn: e.target.value })} /></div>
            <div><Label>Tachostand Ende</Label><Input inputMode="decimal" placeholder="z.B. 25420,5" value={fahrt.tachostandEnde} onChange={(e) => setFahrt({ ...fahrt, tachostandEnde: e.target.value })} /></div>
            <div><Label>KM Gesamt</Label><Input inputMode="decimal" placeholder="auto aus Tachostand" value={fahrt.km} onChange={(e) => setFahrt({ ...fahrt, km: e.target.value })} /></div>
            <div><Label>Kilometergeld (0,30 €/km)</Label><Input readOnly value={fmt(kilometergeld)} style={{ background: "#F3F4F6" }} /></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: cols(3, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label>Deutsche Bahn</Label><Input inputMode="decimal" placeholder="0,00" value={fahrt.bahn} onChange={(e) => setFahrt({ ...fahrt, bahn: e.target.value })} /></div>
            <div><Label>Taxi</Label><Input inputMode="decimal" placeholder="0,00" value={fahrt.taxi} onChange={(e) => setFahrt({ ...fahrt, taxi: e.target.value })} /></div>
            <div><Label>Öffentliche Verkehrsmittel (gesamt)</Label><Input inputMode="decimal" placeholder="0,00" value={fahrt.oev} onChange={(e) => setFahrt({ ...fahrt, oev: e.target.value })} /></div>
          </div>

          <div style={{ fontSize: 12, color: TOKENS.textMut }}>
            Zwischensumme Fahrtkosten: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumFahrt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Verpflegung (mit ausklappbaren Abzügen) */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Verpflegungsmehraufwand</CardTitle></CardHeader>
        <CardContent>
          {/* Hauptwerte */}
          <div style={{ display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label>Tage &gt; 8 Std.</Label><Input inputMode="numeric" value={verpf.tage8} onChange={(e) => setVerpf({ ...verpf, tage8: e.target.value })} /></div>
            <div><Label>Satz (€/Tag)</Label><Input inputMode="decimal" value={verpf.satz8} onChange={(e) => setVerpf({ ...verpf, satz8: e.target.value })} /></div>
            <div><Label>Tage 24 Std.</Label><Input inputMode="numeric" value={verpf.tage24} onChange={(e) => setVerpf({ ...verpf, tage24: e.target.value })} /></div>
            <div><Label>Satz (€/Tag)</Label><Input inputMode="decimal" value={verpf.satz24} onChange={(e) => setVerpf({ ...verpf, satz24: e.target.value })} /></div>
          </div>

          {/* Toggle für optionale Abzüge */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <div style={{ fontSize: 12, color: TOKENS.textMut }}>Optional: Abzüge für Frühstück, Mittag- und Abendessen</div>
            <Button variant="secondary" aria-expanded={showDeductions} onClick={() => setShowDeductions((s) => !s)} style={{ height: 32, padding: "0 10px" }}>
              {showDeductions ? "▼ Ausblenden" : "▶ Anzeigen"}
            </Button>
          </div>

          {/* Ausklappbarer Bereich */}
          <div
            style={{ overflow: "hidden", transition: "max-height .24s ease", maxHeight: showDeductions ? 600 : 0 }}
            aria-hidden={!showDeductions}
          >
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
              <div><Label>abzgl. Frühstück (Anzahl)</Label><Input inputMode="numeric" value={verpf.fruehstueckAbz} onChange={(e) => setVerpf({ ...verpf, fruehstueckAbz: e.target.value })} /></div>
              <div><Label>Abzug pro Frühstück (€)</Label><Input inputMode="decimal" value={verpf.abzFruehstueck} onChange={(e) => setVerpf({ ...verpf, abzFruehstueck: e.target.value })} /></div>
              <div><Label>abzgl. Mittagessen (Anzahl)</Label><Input inputMode="numeric" value={verpf.mittagAbz} onChange={(e) => setVerpf({ ...verpf, mittagAbz: e.target.value })} /></div>
              <div><Label>Abzug pro Mittagessen (€)</Label><Input inputMode="decimal" value={verpf.abzMittag} onChange={(e) => setVerpf({ ...verpf, abzMittag: e.target.value })} /></div>
              <div><Label>abzgl. Abendessen (Anzahl)</Label><Input inputMode="numeric" value={verpf.abendAbz} onChange={(e) => setVerpf({ ...verpf, abendAbz: e.target.value })} /></div>
              <div><Label>Abzug pro Abendessen (€)</Label><Input inputMode="decimal" value={verpf.abzAbend} onChange={(e) => setVerpf({ ...verpf, abzAbend: e.target.value })} /></div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: TOKENS.textMut, marginTop: 8 }}>
            Zwischensumme: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumVerpf)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Übernachtung */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Übernachtungskosten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label>Tatsächliche Kosten (ohne Verpflegung)</Label><Input inputMode="decimal" value={uebernacht.tatsaechlich} onChange={(e) => setUebernacht({ ...uebernacht, tatsaechlich: e.target.value })} /></div>
            <div><Label>Pauschale</Label><Input inputMode="decimal" value={uebernacht.pauschale} onChange={(e) => setUebernacht({ ...uebernacht, pauschale: e.target.value })} /></div>
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
                  <Input placeholder="z.B. Smart Charge" value={r.text} onChange={(e) => setAuslagen((a) => a.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))} />
                </div>
                <div style={{ gridColumn: isDesktop(width) ? "span 2" : "span 1" }}>
                  <Label>Betrag (€)</Label>
                  <Input inputMode="decimal" placeholder="0,00" value={r.betrag} onChange={(e) => setAuslagen((a) => a.map((x) => (x.id === r.id ? { ...x, betrag: e.target.value } : x)))} />
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

      {/* Belege */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Belege hochladen</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Input id="file" type="file" multiple accept="image/*,application/pdf" onChange={handleFileInputChange} style={{ maxWidth: 480 }} />
            <div style={{ fontSize: 12, color: TOKENS.textMut }}>Bilder & PDFs werden komprimiert und jeweils seitenfüllend auf DIN A4 angehängt.</div>
          </div>
          <div
            ref={dropRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{ marginTop: 8, border: `2px dashed ${isDragging ? TOKENS.focus : TOKENS.border}`, background: isDragging ? "rgba(37,99,235,0.06)" : "#fff", borderRadius: TOKENS.radius, padding: 24, textAlign: "center", color: TOKENS.textDim, transition: "all .15s ease" }}
          >
            {isDragging ? "Dateien hierher loslassen…" : "…oder Dateien hierher ziehen und ablegen (Bilder, PDFs)"}
          </div>
          {attachments.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: cols(4, 3, 2), columnGap: colGap, rowGap: 24 }}>
              {attachments.map((att, i) => (
                <div key={i} style={{ border: `1px solid ${TOKENS.border}`, borderRadius: TOKENS.radius, padding: 10, display: "grid", alignItems: "center", justifyItems: "center", gridTemplateRows: "1fr", aspectRatio: "1 / 1", overflow: "hidden", position: "relative", background: "#fff" }}>
                  <Button variant="ghost" onClick={() => removeAttachment(i)} title="Beleg entfernen" style={{ position: "absolute", top: 8, right: 8, height: 30, padding: "0 10px", borderRadius: 10, backdropFilter: "blur(2px)" }}>Entfernen ✕</Button>
                  {att.kind === "image" ? (
                    <img src={att.dataUrl} alt={att.name} style={{ objectFit: "contain", maxWidth: "100%", maxHeight: "100%" }} />
                  ) : (
                    <div style={{ textAlign: "center", fontSize: 12, color: TOKENS.textDim, padding: 8 }}>
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

      {/* Zusammenfassung / Aktionen */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Gesamtsumme</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(gesamt)}</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Button onClick={generatePDF} disabled={busy || !basisOk}>{busy ? "⏳ Erzeuge PDF…" : "⬇️ PDF erzeugen"}</Button>
              <Button variant="secondary" onClick={() => {
                const kw = basis.kw || "XX";
                const mailto = `mailto:rechnungswesen@tritos-consulting.com?subject=${encodeURIComponent(`Reisekosten KW ${kw}`)}&body=${encodeURIComponent("Bitte die PDF-Reisekostenabrechnung im Anhang einfügen.")}`;
                window.location.href = mailto;
              }}>📧 Email</Button>
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

      {/* Printable area (Deckblatt-Screenshot) */}
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
        {/* Kopf – Logo NICHT hier rendern (kommt in PDF separat) */}
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

        {/* Tabellen */}
        {(() => {
          const cell = { border: "1px solid #000", padding: 8, fontSize: 12, verticalAlign: "top" };
          const header = { fontWeight: 700, marginTop: 16 };
          const amtCell = { ...cell, textAlign: "right", width: 110 };
          const textCell = { ...cell };

          const km = num(fahrt.km);
          const kmCost = kmFlatCost(km, 0.30);

          const abzugFr = num(verpf.fruehstueckAbz) * num(verpf.abzFruehstueck);
          const abzugMi = num(verpf.mittagAbz) * num(verpf.abzMittag);
          const abzugAb = num(verpf.abendAbz) * num(verpf.abzAbend);

          return (
            <>
              {/* Fahrtkosten */}
              <div style={header}>Fahrtkosten</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup><col /><col /><col /><col /><col style={{ width: 110 }} /></colgroup>
                <tbody>
                  <tr>
                    <td style={textCell}>Privat-PKW</td>
                    <td style={textCell}>Kennzeichen: {fahrt.kennzeichen || "—"}</td>
                    <td style={textCell}>Tachostand: {fahrt.tachostandBeginn || "—"} → {fahrt.tachostandEnde || "—"}</td>
                    <td style={textCell}>{km} km × 0,30 €/km</td>
                    <td style={amtCell}>{fmt(kmCost)}</td>
                  </tr>
                  <tr><td style={textCell}>Deutsche Bahn</td><td style={textCell} colSpan={3}></td><td style={amtCell}>{fmt(num(fahrt.bahn))}</td></tr>
                  <tr><td style={textCell}>Taxi</td><td style={textCell} colSpan={3}></td><td style={amtCell}>{fmt(num(fahrt.taxi))}</td></tr>
                  <tr><td style={textCell}>Öffentliche Verkehrsmittel</td><td style={textCell} colSpan={3}></td><td style={amtCell}>{fmt(num(fahrt.oev))}</td></tr>
                  <tr><td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme Fahrtkosten</td><td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumFahrt)}</td></tr>
                </tbody>
              </table>

              {/* Verpflegung */}
              <div style={header}>Verpflegungsmehraufwand</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup><col /><col /><col /><col /><col style={{ width: 110 }} /></colgroup>
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

                  {num(verpf.fruehstueckAbz) > 0 && (
                    <tr>
                      <td style={textCell}>abzgl. Frühstück</td>
                      <td style={textCell}>{verpf.fruehstueckAbz}</td>
                      <td style={textCell}>{fmt(num(verpf.abzFruehstueck))} pro Frühstück</td>
                      <td style={textCell}></td>
                      <td style={amtCell}>- {fmt(abzugFr)}</td>
                    </tr>
                  )}
                  {num(verpf.mittagAbz) > 0 && (
                    <tr>
                      <td style={textCell}>abzgl. Mittagessen</td>
                      <td style={textCell}>{verpf.mittagAbz}</td>
                      <td style={textCell}>{fmt(num(verpf.abzMittag))} pro Mittagessen</td>
                      <td style={textCell}></td>
                      <td style={amtCell}>- {fmt(abzugMi)}</td>
                    </tr>
                  )}
                  {num(verpf.abendAbz) > 0 && (
                    <tr>
                      <td style={textCell}>abzgl. Abendessen</td>
                      <td style={textCell}>{verpf.abendAbz}</td>
                      <td style={textCell}>{fmt(num(verpf.abzAbend))} pro Abendessen</td>
                      <td style={textCell}></td>
                      <td style={amtCell}>- {fmt(abzugAb)}</td>
                    </tr>
                  )}

                  <tr>
                    <td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme</td>
                    <td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumVerpf)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Übernachtung */}
              <div style={header}>Übernachtungskosten</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup><col /><col /><col /><col /><col style={{ width: 110 }} /></colgroup>
                <tbody>
                  <tr><td style={textCell}>Tatsächliche Kosten (ohne Verpflegung)</td><td style={textCell} colSpan={3}></td><td style={amtCell}>{fmt(num(uebernacht.tatsaechlich))}</td></tr>
                  <tr><td style={textCell}>Pauschale</td><td style={textCell} colSpan={3}></td><td style={amtCell}>{fmt(num(uebernacht.pauschale))}</td></tr>
                  <tr><td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme</td><td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumUebernacht)}</td></tr>
                </tbody>
              </table>

              {/* Auslagen */}
              <div style={header}>Sonstige Auslagen</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
                <colgroup><col /><col /><col /><col /><col style={{ width: 110 }} /></colgroup>
                <tbody>
                  {auslagen.map((r, i) => (
                    <tr key={i}><td style={textCell} colSpan={4}>{r.text || "—"}</td><td style={amtCell}>{fmt(num(r.betrag))}</td></tr>
                  ))}
                  <tr><td style={{ ...textCell, fontWeight: 700 }} colSpan={4}>Zwischensumme</td><td style={{ ...amtCell, fontWeight: 700 }}>{fmt(sumAuslagen)}</td></tr>
                </tbody>
              </table>

              <div style={{ textAlign: "right", marginTop: 16, fontWeight: 700, fontSize: 14 }}>
                Gesamte Reisekosten: {fmt(gesamt)}
              </div>
            </>
          );
        })()}
      </div>

      {/* Hinweis + Tests */}
      <div style={{ fontSize: 12, color: TOKENS.textMut, marginTop: 8 }}>📷 Tipp: Bilder & PDFs hier hochladen – sie landen automatisch (komprimiert) in der Export-PDF.</div>
      {testOutput.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card>
            <CardHeader><CardTitle>Testergebnisse</CardTitle></CardHeader>
            <CardContent>
              <ul style={{ display: "grid", gap: 6, fontSize: 14, margin: 0, paddingLeft: 16 }}>
                {testOutput.map((t, i) => (
                  <li key={i} style={{ color: t.ok ? "#059669" : "#DC2626" }}>{t.ok ? "✔" : "✖"} {t.name} {t.msg ? `– ${t.msg}` : ""}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
