"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Trash2 } from "lucide-react";
import { Company, Contract } from "@/lib/model";
import { supabase } from "@/lib/supabase";

export function CompaniesPanel({ companies, contracts, ownerId, lang, selectedId, onSelect, onSave, onDelete }: {
  companies: Company[];
  contracts: Contract[];
  ownerId: string;
  lang: "en" | "hi";
  selectedId: string;
  onSelect: (id: string) => void;
  onSave: (company: Company, oldLogo?: string) => void;
  onDelete: (company: Company) => void;
}) {
  const hi = lang === "hi";
  const [editId, setEditId] = useState<string | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState("");
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = companies.find(x => x.id === editId);

  useEffect(() => {
    let live = true;
    const client = supabase;
    if (!client) return;
    void Promise.all(companies.filter(c => c.logoPath).map(async c => {
      const { data } = await client.storage.from("company-logos").createSignedUrl(c.logoPath!, 3600);
      return [c.id, data?.signedUrl || ""] as const;
    })).then(pairs => { if (live) setSigned(Object.fromEntries(pairs.filter(([, url]) => url))); });
    return () => { live = false; };
  }, [companies]);
  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  async function save(form: FormData) {
    if (busy) return;
    const name = String(form.get("name") || "").trim();
    if (!name || companies.some(c => c.id !== editId && c.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(name ? (hi ? "इस नाम की कंपनी पहले से है।" : "A company with this name already exists.") : (hi ? "कंपनी का नाम लिखें।" : "Enter a company name."));
      return;
    }
    const file = form.get("logo");
    if (file instanceof File && file.size && (!supabase || !ownerId || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      setError(hi ? "JPG, PNG या WebP चित्र चुनें, अधिकतम 2 MB।" : "Choose a JPG, PNG or WebP image up to 2 MB."); return;
    }
    setBusy(true); setError("");
    const id = editing?.id || crypto.randomUUID();
    let logoPath = removeLogo ? undefined : editing?.logoPath;
    if (file instanceof File && file.size && supabase) {
      const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      logoPath = `companies/${ownerId}/${id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("company-logos").upload(logoPath, file, { contentType: file.type, upsert: false });
      if (uploadError) { setBusy(false); setError((hi ? "लोगो अपलोड नहीं हुआ: " : "Logo upload failed: ") + uploadError.message); return; }
    }
    onSave({ id, name, phone: String(form.get("phone") || "").trim() || undefined, contactName: String(form.get("contactName") || "").trim() || undefined, notes: String(form.get("notes") || "").trim() || undefined, logoPath }, editing?.logoPath);
    setEditId(null); setPreview(""); setRemoveLogo(false); setBusy(false);
  }

  return <section className="panel section-panel company-management">
    <div className="table-toolbar"><div><h2>{hi ? "कंपनियाँ और साइट" : "Companies and sites"}</h2><p>{hi ? "कंपनी का नाम चुनें और उसके जुड़े ठेके देखें।" : "Choose a company to see its linked contracts and work sites."}</p></div><button className="button button-primary" onClick={() => { setEditId(""); setPreview(""); setError(""); }}><Plus size={16}/>{hi ? "कंपनी जोड़ें" : "Add company"}</button></div>
    {editId !== null && <form className="company-editor" action={save}><h3>{editing ? (hi ? "कंपनी बदलें" : "Edit company") : (hi ? "नई कंपनी" : "New company")}</h3><label>{hi ? "कंपनी का नाम" : "Company name"}<input name="name" required defaultValue={editing?.name || ""}/></label><div className="form-row"><label>{hi ? "संपर्क व्यक्ति" : "Contact name"}<input name="contactName" defaultValue={editing?.contactName || ""}/></label><label>{hi ? "फ़ोन" : "Phone"}<input name="phone" inputMode="tel" defaultValue={editing?.phone || ""}/></label></div><label>{hi ? "नोट" : "Notes"}<textarea name="notes" rows={2} defaultValue={editing?.notes || ""}/></label><div className="company-logo-preview">{preview ? <img src={preview} alt="Logo preview"/> : editing?.logoPath && !removeLogo && signed[editing.id] ? <img src={signed[editing.id]} alt={editing.name+" logo"}/> : <span>{(editing?.name || "LF").split(" ").map(x => x[0]).slice(0,2).join("").toUpperCase()}</span>}</div><label>{hi ? "लोगो · JPG/PNG/WebP · 2 MB तक" : "Logo · JPG/PNG/WebP · up to 2 MB"}<input name="logo" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const f=e.currentTarget.files?.[0];if(!f)return;if(!["image/jpeg","image/png","image/webp"].includes(f.type)||f.size>2*1024*1024){setError(hi?"JPG, PNG या WebP चित्र चुनें, अधिकतम 2 MB।":"Choose a JPG, PNG or WebP image up to 2 MB.");e.currentTarget.value="";return}setRemoveLogo(false);setError("");setPreview(URL.createObjectURL(f)); }}/></label>{editing?.logoPath&&<button type="button" className="table-action danger-text" onClick={()=>{setRemoveLogo(v=>!v);setPreview("")}}>{removeLogo?(hi?"लोगो बनाए रखें":"Keep current logo"):(hi?"लोगो हटाएँ":"Remove current logo")}</button>}{error&&<div className="auth-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={()=>{setEditId(null);setPreview("");setRemoveLogo(false)}}>{hi?"रद्द करें":"Cancel"}</button><button className="button button-primary" disabled={busy}>{busy?(hi?"सहेज रहे हैं…":"Saving…"):(hi?"सहेजें":"Save company")}</button></div></form>}
    <div className="company-list">{companies.map(c => {const sites=contracts.filter(x=>x.companyId===c.id||x.company.toLowerCase()===c.name.toLowerCase());return <article key={c.id} className={"company-list-card "+(selectedId===c.id?"selected":"")}><button className="company-open" onClick={()=>onSelect(selectedId===c.id?"":c.id)}><span className="company-logo">{signed[c.id]?<img src={signed[c.id]} alt={c.name+" logo"}/>:c.name.split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase()}</span><span><b>{c.name}</b><small>{sites.length} {hi?"ठेके / साइट":"contracts / sites"}</small></span></button><div className="company-actions"><button className="table-action" onClick={()=>{setEditId(c.id);setError("")}}>{hi?"बदलें":"Edit"}</button><button className="table-action danger-text" onClick={()=>onDelete(c)}><Trash2 size={14}/>{hi?"हटाएँ":"Delete"}</button></div></article>})}{companies.length===0&&!editing&&<div className="empty-state"><Building2 size={20}/>{hi?"अभी कोई कंपनी दर्ज नहीं है।":"No companies added yet."}</div>}</div>
  </section>;
}
