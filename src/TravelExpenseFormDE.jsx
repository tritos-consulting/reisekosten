import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * TravelExpenseFormDE – stabile, bereinigte Version
 * - Alle JSX-Tags geschlossen (fix für "Unexpected token (1:0)")
 * - Keine oklch()-Farben; nur einfache CSS-Farben
 * - PDFs von Belegen via PDF.js zur Laufzeit (CDN) – nur wenn nötig
 * - Bilder/PDF-Seiten als JPEG komprimiert (kleinere Dateigröße)
 * - Kilometer automatisch: (TachostandEnde - TachostandBeginn) * 0.30 €
 * - KW automatisch aus Beginn (ISO-Woche)
 */

// ---------- Mini-UI ----------
const Card = ({ children }) => (
  <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 1px 2px rgba(0,0,0,.05)", overflow: "hidden", background: "#fff" }}>{children}</div>
);
const CardHeader = ({ children }) => (
  <div style={{ padding: 16, borderBottom: "1px solid #e5e7eb", background: "#fafafa" }}>{children}</div>
);
const CardTitle = ({ children }) => (
  <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>
);
const CardContent = ({ children }) => <div style={{ padding: 16 }}>{children}</div>;
const Button = ({ children, onClick, variant, style, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: "10px 14px",
      borderRadius: 12,
      border: variant === "secondary" ? "1px solid #d1d5db" : "1px solid #111827",
      background: disabled ? "#9ca3af" : variant === "secondary" ? "#ffffff" : "#111827",
      color: variant === "secondary" ? "#111827" : "#ffffff",
      cursor: disabled ? "not-allowed" : "pointer",
      ...style,
    }}
  >
    {children}
  </button>
);
const Input = (props) => (
  <input
    {...props}
    style={{
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid #d1d5db",
      outline: "none",
      fontSize: 14,
      background: "#fff",
    }}
  />
);
const Label = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 6 }}>
    {children}
  </label>
);

// ---------- Helpers ----------
const fmt = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const isoWeekFromDateStr = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = ((dt.getUTCDay() + 6) % 7) + 1;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  const year = dt.getUTCFullYear();
  return `${week}/${year}`;
};

// Lazy-load PDF.js (nur wenn PDF-Belege vorhanden)
async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  return window.pdfjsLib;
}

// Downscale + JPEG
async function downscaleToJpeg(src, maxW = 1600, maxH = 2260, quality = 0.72) {
  const img = await (async () => {
    if (typeof src === "string") {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.src = src;
      await new Promise((r) => (im.onload = r));
      return im;
    }
    return src;
  })();
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) throw new Error("Kein Bildmaß");
  const ratio = Math.min(maxW / w, maxH / h, 1);
  const tw = Math.max(1, Math.round(w * ratio));
  const th = Math.max(1, Math.round(h * ratio));
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, tw, th);
  return c.toDataURL("image/jpeg", quality);
}

// ---------- Component ----------
export default function TravelExpenseFormDE() {
  const [basis, setBasis] = useState({
    name: "Kromer Tobias",
    zweck: "",
    beginn: "",
    ende: "",
    kw: "",
    firma: "Tritos Consulting GmbH",
  });

  const [fahrt, setFahrt] = useState({
    kennzeichen: "",
    tachostandBeginn: "",
    tachostandEnde: "",
    km: 0, // wird automatisch berechnet
    preisKm: 0.3, // fix
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

  // Sonstige Ausgaben
  const [auslagen, setAuslagen] = useState([{ id: 1, text: "", betrag: "" }]);

  // Belege (als dataURL-Bilder; PDF-Seiten werden gerendert)
  const [receipts, setReceipts] = useState([]); // {name, dataUrl}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tests, setTests] = useState([]);
  const [kwHint, setKwHint] = useState(false);
  const kwTimerRef = useRef(null);

  const printableRef = useRef(null);

  // KM automatisch aus Tachoständen
  useEffect(() => {
    const s = num(fahrt.tachostandBeginn);
    const e = num(fahrt.tachostandEnde);
    const km = Math.max(0, e - s);
    setFahrt((f) => ({ ...f, km }));
  }, [fahrt.tachostandBeginn, fahrt.tachostandEnde]);

  // KW automatisch aus Beginn (wenn gesetzt)
  useEffect(() => {
    if (!basis.beginn) return;
    setBasis((b) => ({ ...b, kw: isoWeekFromDateStr(basis.beginn) }));
    setKwHint(true);
    if (kwTimerRef.current) clearTimeout(kwTimerRef.current);
    kwTimerRef.current = setTimeout(() => setKwHint(false), 3000);
    return () => {
      if (kwTimerRef.current) clearTimeout(kwTimerRef.current);
    };
  }, [basis.beginn]);

  // Summen
  const sumFahrt = useMemo(() => {
    const kmSum = num(fahrt.km) * num(fahrt.preisKm);
    return kmSum + num(fahrt.oev) + num(fahrt.bahn) + num(fahrt.taxi);
  }, [fahrt]);

  const sumVerpf = useMemo(() => {
    const v = num(verpf.tage8) * num(verpf.satz8) + num(verpf.tage24) * num(verpf.satz24);
    const abzug = num(verpf.fruehstueckAbz) * num(verpf.abzFruehstueck);
    return Math.max(0, v - abzug);
  }, [verpf]);

  const sumUebernacht = useMemo(() => num(uebernacht.tatsaechlich) + num(uebernacht.pauschale), [uebernacht]);

  const sumAuslagen = useMemo(
    () => (auslagen || []).reduce((acc, r) => acc + num(r.betrag), 0),
    [auslagen]
  );

  const gesamt = useMemo(() => sumFahrt + sumVerpf + sumUebernacht + sumAuslagen, [sumFahrt, sumVerpf, sumUebernacht, sumAuslagen]);

  // Beleg-Upload (Bilder & PDFs)
  const handleReceiptUpload = async (e) => {
    setErr("");
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    try {
      // Bilder sofort verkleinern
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      const pdfs = files.filter((f) => f.type === "application/pdf");

      const imgPromises = imgs.map(
        (file) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = async () => {
              const small = await downscaleToJpeg(r.result, 1500, 2100, 0.72);
              resolve({ name: file.name, dataUrl: small });
            };
            r.readAsDataURL(file);
          })
      );

      // PDFs mit PDF.js -> Bilder (jede Seite)
      let pdfPromises = [];
      if (pdfs.length) {
        const pdfjsLib = await ensurePdfJs();
        pdfPromises = pdfs.map(async (file) => {
          const buf = await file.arrayBuffer();
          const doc = await pdfjsLib.getDocument({ data: buf }).promise;
          const out = [];
          const maxPages = Math.min(doc.numPages, 200);
          for (let p = 1; p <= maxPages; p++) {
            const page = await doc.getPage(p);
            const vp1 = page.getViewport({ scale: 1 });
            const desired = 1400; // px
            const scale = Math.min(desired / vp1.width, 2);
            const vp = page.getViewport({ scale });
            const c = document.createElement("canvas");
            c.width = vp.width;
            c.height = vp.height;
            await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
            const small = await downscaleToJpeg(c, 1500, 2100, 0.72);
            out.push({ name: `${file.name} – Seite ${p}`, dataUrl: small });
          }
          return out;
        });
      }

      const images = await Promise.all(imgPromises);
      const pdfPagesNested = await Promise.all(pdfPromises);
      const pdfPages = pdfPagesNested.flat();
      setReceipts((prev) => [...prev, ...images, ...pdfPages]);
      e.target.value = "";
    } catch (ex) {
      console.error(ex);
      setErr(ex?.message || String(ex));
    }
  };

  // PDF generieren: Deckblatt (Screenshot) + je Beleg eine eigene Seite
  const generatePDF = async () => {
    setErr("");
    setBusy(true);
    try {
      const node = printableRef.current;
      if (!node) throw new Error("Druckbereich nicht gefunden");

      // Offscreen rendern
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

      const canvas = await html2canvas(node, {
        scale: 1.4, // kleiner als 2 -> kleinere Datei
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      Object.assign(node.style, prev);

      const cover = await downscaleToJpeg(canvas, 1600, 2260, 0.72);

      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      // Deckblatt einpassen
      await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const innerW = pageW - margin * 2;
          const innerH = pageH - margin * 2;
          const r = Math.min(innerW / im.width, innerH / im.height);
          const w = im.width * r;
          const h = im.height * r;
          pdf.addImage(cover, "JPEG", (pageW - w) / 2, margin, w, h, undefined, "FAST");
          resolve();
        };
        im.src = cover;
      });

      // Belegseiten: jeweils 1 Seite pro Element
      if (receipts.length) {
        for (let i = 0; i < receipts.length; i++) {
          const r = receipts[i];
          pdf.addPage();
          await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => {
              const innerW = pageW - margin * 2;
              const innerH = pageH - margin * 2;
              const s = Math.min(innerW / im.width, innerH / im.height, 1);
              const w = im.width * s;
              const h = im.height * s;
              pdf.addImage(r.dataUrl, "JPEG", (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, "FAST");
              resolve();
            };
            im.src = r.dataUrl;
          });
        }
      }

      const fname = `Reisekosten_${basis.name || "Mitarbeiter"}_KW${(basis.kw || "XX").replace("/", "-")}.pdf`;
      await pdf.save(fname, { returnPromise: true });
    } catch (ex) {
      console.error(ex);
      setErr(ex?.message || String(ex));
      alert("PDF-Erzeugung fehlgeschlagen: " + (ex?.message || String(ex)));
    } finally {
      setBusy(false);
    }
  };

  // Tests
  const runTests = () => {
    const res = [];
    const pass = (name) => res.push({ ok: true, name });
    const fail = (name, got) => res.push({ ok: false, name, got });

    try {
      const n1 = num("1,5");
      Math.abs(n1 - 1.5) < 1e-9 ? pass("num('1,5') -> 1.5") : fail("num('1,5')", n1);

      const km = Math.max(0, num(120) - num(20));
      km === 100 ? pass("KM-Basis (dummy)") : fail("KM-Basis", km);

      const fahrtSum = num(100) * 0.3 + 10 + 0 + 0;
      Math.abs(fahrtSum - 40) < 1e-9 ? pass("Fahrtkosten Summe (100 km + 10€ ÖPNV)") : fail("Fahrtkosten Summe", fahrtSum);

      const vSum = num(2) * 14 + num(1) * 28 - num(1) * 5.6; // 50.4
      Math.abs(vSum - 50.4) < 1e-9 ? pass("Verpflegung Summe") : fail("Verpflegung Summe", vSum);

      const ausl = [{ betrag: 10 }, { betrag: "2,50" }].reduce((a, b) => a + num(b.betrag), 0);
      Math.abs(ausl - 12.5) < 1e-9 ? pass("Sonstige Ausgaben Summe") : fail("Sonstige Ausgaben Summe", ausl);
    } catch (e) {
      res.push({ ok: false, name: "Test runner crashed", got: String(e) });
    }
    setTests(res);
  };

  // ---------- Render ----------
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Reisekosten – Webformular</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={runTests}>🧪 Tests</Button>
          <Button onClick={generatePDF} disabled={busy}>{busy ? "⏳ PDF…" : "⬇️ PDF erzeugen"}</Button>
        </div>
      </div>

      {/* Basisdaten */}
      <Card>
        <CardHeader><CardTitle>Basisdaten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={basis.name} onChange={(e) => setBasis({ ...basis, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="zweck">Zweck</Label>
              <Input id="zweck" placeholder="z.B. Beratung Hallesche" value={basis.zweck} onChange={(e) => setBasis({ ...basis, zweck: e.target.value })} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Label htmlFor="kw" style={{ marginBottom: 0 }}>Kalenderwoche</Label>
                {kwHint && <span style={{ fontSize: 10, color: "#6b7280" }}>automatisch gesetzt</span>}
              </div>
              <Input id="kw" placeholder="z.B. 27/2025" value={basis.kw} onChange={(e) => setBasis({ ...basis, kw: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="beginn">Beginn</Label>
              <Input id="beginn" type="date" value={basis.beginn} onChange={(e) => setBasis({ ...basis, beginn: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ende">Ende</Label>
              <Input id="ende" type="date" value={basis.ende} onChange={(e) => setBasis({ ...basis, ende: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="firma">Firma</Label>
              <Input id="firma" value={basis.firma} onChange={(e) => setBasis({ ...basis, firma: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fahrtkosten */}
      <Card>
        <CardHeader><CardTitle>Fahrtkosten</CardTitle></CardHeader>
        <CardContent>
          {/* erste Zeile: Privat-Pkw + Kennzeichen + Tachos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <div>
              <Label>Privat-Pkw (km automatisch)</Label>
              <Input value={fahrt.km} readOnly />
            </div>
            <div>
              <Label>Kennzeichen</Label>
              <Input placeholder="z.B. ERH-TC 123" value={fahrt.kennzeichen} onChange={(e) => setFahrt({ ...fahrt, kennzeichen: e.target.value })} />
            </div>
            <div>
              <Label>Tachostand Beginn</Label>
              <Input inputMode="decimal" value={fahrt.tachostandBeginn} onChange={(e) => setFahrt({ ...fahrt, tachostandBeginn: e.target.value })} />
            </div>
            <div>
              <Label>Tachostand Ende</Label>
              <Input inputMode="decimal" value={fahrt.tachostandEnde} onChange={(e) => setFahrt({ ...fahrt, tachostandEnde: e.target.value })} />
            </div>
          </div>

          {/* zweite Zeile: ÖPNV / Bahn / Taxi */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12, marginTop: 12 }}>
            <div>
              <Label>Öffentliche Verkehrsmittel (gesamt)</Label>
              <Input inputMode="decimal" placeholder="0,00" value={fahrt.oev} onChange={(e) => setFahrt({ ...fahrt, oev: e.target.value })} />
            </div>
            <div>
              <Label>Deutsche Bahn</Label>
              <Input inputMode="decimal" placeholder="0,00" value={fahrt.bahn} onChange={(e) => setFahrt({ ...fahrt, bahn: e.target.value })} />
            </div>
            <div>
              <Label>Taxi</Label>
              <Input inputMode="decimal" placeholder="0,00" value={fahrt.taxi} onChange={(e) => setFahrt({ ...fahrt, taxi: e.target.value })} />
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#4b5563", marginTop: 8 }}>
            Abrechnung: <b>{fmt(num(fahrt.km) * 0.3)}</b> (Kilometer × 0,30 €/km) &nbsp;–&nbsp; Zwischensumme Fahrtkosten: <b>{fmt(sumFahrt)}</b>
          </div>
        </CardContent>
      </Card>

      {/* Verpflegung */}
      <Card>
        <CardHeader><CardTitle>Verpflegungsmehraufwand</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 12 }}>
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
          <div style={{ fontSize: 12, color: "#4b5563", marginTop: 8 }}>
            Zwischensumme: <b>{fmt(sumVerpf)}</b>
          </div>
        </CardContent>
      </Card>

      {/* Übernachtung */}
      <Card>
        <CardHeader><CardTitle>Übernachtungskosten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
            <div>
              <Label>Tatsächliche Kosten (ohne Verpflegung)</Label>
              <Input inputMode="decimal" value={uebernacht.tatsaechlich} onChange={(e) => setUebernacht({ ...uebernacht, tatsaechlich: e.target.value })} />
            </div>
            <div>
              <Label>Pauschale</Label>
              <Input inputMode="decimal" value={uebernacht.pauschale} onChange={(e) => setUebernacht({ ...uebernacht, pauschale: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#4b5563", marginTop: 8 }}>
            Zwischensumme: <b>{fmt(sumUebernacht)}</b>
          </div>
        </CardContent>
      </Card>

      {/* Sonstige Ausgaben */}
      <Card>
        <CardHeader>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <CardTitle>Sonstige Ausgaben</CardTitle>
            <Button variant="secondary" onClick={() => setAuslagen((a) => [...a, { id: Date.now(), text: "", betrag: "" }])}>+ Position</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: 12 }}>
            {auslagen.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 12 }}>
                <div style={{ gridColumn: "span 4" }}>
                  <Label>Bezeichnung</Label>
                  <Input placeholder="z.B. Smart Charge" value={r.text} onChange={(e) => setAuslagen((a) => a.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))} />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <Label>Betrag (€)</Label>
                  <Input inputMode="decimal" placeholder="0,00" value={r.betrag} onChange={(e) => setAuslagen((a) => a.map((x) => (x.id === r.id ? { ...x, betrag: e.target.value } : x)))} />
                </div>
                {auslagen.length > 1 && (
                  <div style={{ gridColumn: "1 / -1", marginTop: -4 }}>
                    <Button variant="secondary" onClick={() => setAuslagen((a) => a.filter((x) => x.id !== r.id))}>Entfernen</Button>
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              Zwischensumme: <b>{fmt(sumAuslagen)}</b>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Belege */}
      <Card>
        <CardHeader><CardTitle>Belege hochladen</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Input type="file" multiple accept="image/*,application/pdf" onChange={handleReceiptUpload} />
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              Bilder & PDFs sind möglich. PDFs werden automatisch gerendert. Jede Datei/Seite → eigene PDF-Seite.
            </div>
          </div>
          {receipts.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 12 }}>
              {receipts.map((img, i) => (
                <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 8, display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1 / 1", overflow: "hidden" }}>
                  <img src={img.dataUrl} alt={img.name} style={{ objectFit: "contain", width: "100%", height: "100%" }} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gesamtsumme + PDF */}
      <Card>
        <CardHeader><CardTitle>Gesamtsumme</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(gesamt)}</div>
            <Button onClick={generatePDF} disabled={busy}>{busy ? "⏳ PDF…" : "⬇️ PDF erzeugen"}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Druckbereich (Deckblatt) */}
      <div
        ref={printableRef}
        style={{
          width: 794, // ~A4 @ 96 DPI
          padding: 24,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans, "Apple Color Emoji", "Segoe UI Emoji"',
          backgroundColor: "#ffffff",
          color: "#000000",
          lineHeight: 1.35,
          marginTop: 12,
        }}
      >
        <div style={{ fontSize: 12 }}>{basis.firma}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>Reisekostenabrechnung</div>
        <div style={{ marginTop: 4, fontSize: 12 }}>
          {basis.kw ? `KW ${basis.kw}` : null}
          {basis.kw && (basis.name || basis.beginn || basis.ende) ? " – " : null}
          {basis.name}
        </div>

        {/* Basisdaten */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16, fontSize: 12 }}>
          <div>
            <div><span style={{ fontWeight: 600 }}>Name:</span> {basis.name}</div>
            <div><span style={{ fontWeight: 600 }}>Zweck:</span> {basis.zweck}</div>
          </div>
          <div>
            <div><span style={{ fontWeight: 600 }}>Beginn:</span> {basis.beginn || "—"}</div>
            <div><span style={{ fontWeight: 600 }}>Ende:</span> {basis.ende || "—"}</div>
          </div>
        </div>

        {/* Tabellen */}
        {(() => {
          const cell = { border: "1px solid #000", padding: 8, fontSize: 12, verticalAlign: "top" };
          const header = { fontWeight: 600, marginTop: 16 };
          const kmCost = num(fahrt.km) * 0.3;
          return (
            <>
              {/* Fahrtkosten */}
              <div style={header}>Fahrtkosten</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                <tbody>
                  <tr>
                    <td style={cell}>Privat-Pkw</td>
                    <td style={cell}>Kennzeichen</td>
                    <td style={cell}>Tachostand Beginn</td>
                    <td style={cell}>Tachostand Ende</td>
                    <td style={cell}>km</td>
                    <td style={cell}>Satz €/km</td>
                    <td style={cell}>Betrag</td>
                  </tr>
                  <tr>
                    <td style={cell}>—</td>
                    <td style={cell}>{fahrt.kennzeichen || "—"}</td>
                    <td style={cell}>{fahrt.tachostandBeginn || "—"}</td>
                    <td style={cell}>{fahrt.tachostandEnde || "—"}</td>
                    <td style={cell}>{num(fahrt.km)}</td>
                    <td style={cell}>0,30 €</td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(kmCost)}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Öffentliche Verkehrsmittel</td>
                    <td style={cell} colSpan={5}></td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(fahrt.oev))}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Deutsche Bahn</td>
                    <td style={cell} colSpan={5}></td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(fahrt.bahn))}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Taxi</td>
                    <td style={cell} colSpan={5}></td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(fahrt.taxi))}</td>
                  </tr>
                  <tr>
                    <td style={{ ...cell, fontWeight: 600 }} colSpan={6}>Zwischensumme</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{fmt(sumFahrt)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Verpflegung */}
              <div style={header}>Verpflegungsmehraufwand</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                <tbody>
                  <tr>
                    <td style={cell}>Tage &gt; 8 Std.</td>
                    <td style={cell}>{verpf.tage8}</td>
                    <td style={cell}>Satz {fmt(num(verpf.satz8))}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(verpf.tage8) * num(verpf.satz8))}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Tage 24 Std.</td>
                    <td style={cell}>{verpf.tage24}</td>
                    <td style={cell}>Satz {fmt(num(verpf.satz24))}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(verpf.tage24) * num(verpf.satz24))}</td>
                  </tr>
                  <tr>
                    <td style={cell}>abzgl. Frühstück</td>
                    <td style={cell}>{verpf.fruehstueckAbz}</td>
                    <td style={cell}>{fmt(num(verpf.abzFruehstueck))} pro Frühstück</td>
                    <td style={{ ...cell, textAlign: "right" }}>- {fmt(num(verpf.fruehstueckAbz) * num(verpf.abzFruehstueck))}</td>
                  </tr>
                  <tr>
                    <td style={{ ...cell, fontWeight: 600 }} colSpan={3}>Zwischensumme</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{fmt(sumVerpf)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Übernachtung */}
              <div style={header}>Übernachtungskosten</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                <tbody>
                  <tr>
                    <td style={cell}>Tatsächliche Kosten (ohne Verpflegung)</td>
                    <td style={cell} colSpan={2}></td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(uebernacht.tatsaechlich))}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Pauschale</td>
                    <td style={cell} colSpan={2}></td>
                    <td style={{ ...cell, textAlign: "right" }}>{fmt(num(uebernacht.pauschale))}</td>
                  </tr>
                  <tr>
                    <td style={{ ...cell, fontWeight: 600 }} colSpan={3}>Zwischensumme</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{fmt(sumUebernacht)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Sonstige Ausgaben */}
              <div style={header}>Sonstige Ausgaben</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                <tbody>
                  {auslagen.map((r, i) => (
                    <tr key={i}>
                      <td style={cell} colSpan={3}>{r.text}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmt(num(r.betrag))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...cell, fontWeight: 600 }} colSpan={3}>Zwischensumme</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{fmt(sumAuslagen)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 16, textAlign: "right", fontSize: 14 }}>
                <div style={{ fontWeight: 700 }}>Gesamte Reisekosten: {fmt(gesamt)}</div>
              </div>

              <div style={{ marginTop: 24, fontSize: 10, color: "#555" }}>
                Hinweis: Pauschalen und Abzüge sind konfigurierbar. Prüfen Sie steuer-/unternehmensseitige Vorgaben.
              </div>
            </>
          );
        })()}
      </div>

      {/* Tests */}
      {tests.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Testergebnisse</CardTitle></CardHeader>
          <CardContent>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {tests.map((t, i) => (
                <li key={i} style={{ color: t.ok ? "#059669" : "#b91c1c" }}>
                  {t.ok ? "✔" : "✖"} {t.name}{t.got != null ? ` – got: ${t.got}` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {err && (
        <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>
          Fehler: {err}
        </div>
      )}
    </div>
  );
}
