import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap, ifMatch } from "@/api/client";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { useIsPlatformAdmin } from "../hooks";
import s from "./signed-exports.module.css";

export function SignedExports() {
 const admin = useIsPlatformAdmin();
 const settings = useQuery({queryKey:["audit-export-settings"],queryFn:async()=>unwrap(await api.GET("/v1/admin/audit-export-settings"))});
 const exports = useQuery({queryKey:["audit-exports"],queryFn:async()=>unwrap(await api.GET("/v1/admin/audit-exports"))});
 const [start,setStart]=useState("");
 const [day,setDay]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const cfg=settings.data;
 async function act(work:()=>Promise<unknown>) {
  setBusy(true);setError("");
  try{await work();await Promise.all([settings.refetch(),exports.refetch()]);}
  catch(e){setError(e instanceof Error?e.message:"Export request failed");}
  finally{setBusy(false);}
 }
 return <section className={s.panel} aria-labelledby="signed-export-heading">
  <h2 id="signed-export-heading">Signed daily exports</h2>
  {(settings.error || exports.error) && <p role="alert">Export information could not be loaded. <Button variant="secondary" onClick={()=>void act(async()=>{await settings.refetch();await exports.refetch();})}>Reload export information</Button></p>}
  {cfg && <>
   <p>{cfg.enabled?"Approved for automatic daily export":"Off — no daily exports approved"}. Destination: built-in private storage. Coverage starts {cfg.coverageStart} UTC.</p>
   <p>Operator signing key: {cfg.keyReady ? cfg.keyId : "Unavailable — an operator must configure a private signing-key file."}</p>
   <p>Late facts are carried forward, not added to old files. Signatures authenticate projected facts, not source completeness. Approval protects covered unfrozen facts from normal retention; earlier purges cannot be recovered. Independently retain trusted public keys and first/latest checkpoints.</p>
   {admin && <div className={s.controls}>
    <Field label="First covered UTC day"><Input type="date" value={start||cfg.coverageStart} onValueChange={setStart}/></Field>
    <Button loading={busy} variant="secondary" onClick={()=>void act(async()=>unwrap(await api.PUT("/v1/admin/audit-export-settings",{params:{header:ifMatch(cfg.revision)},body:{enabled:!cfg.enabled,coverageStart:start||cfg.coverageStart,destination:"builtin"}})))}>{cfg.enabled?"Turn off daily exports":"Approve daily exports"}</Button>
    <Field label="Next closed UTC day"><Input type="date" value={day} onValueChange={setDay}/></Field>
    <Button loading={busy} onClick={()=>void act(async()=>unwrap(await api.POST("/v1/admin/audit-exports",{params:{header:ifMatch(cfg.revision)},body:{day}})))}>Create daily export</Button>
   </div>}
  </>}
  {error && <p role="alert">{error}</p>}
  <Button variant="secondary" loading={busy} onClick={()=>void act(async()=>{await exports.refetch();await settings.refetch();})}>Refresh export status</Button>
  <ul className={s.list}>{exports.data?.map(row=><li key={row.id}>
   <p>{row.day} UTC — {row.state}{row.failureCode && ` (${row.failureCode})`}</p>
   {row.state==="failed" && admin && <Button loading={busy} variant="secondary" onClick={()=>void act(async()=>unwrap(await api.POST("/v1/admin/audit-exports/{exportId}/retry",{params:{path:{exportId:row.id},header:ifMatch(row.revision)}})))}>Retry {row.day}</Button>}
   {row.state==="completed" && <>
    <a href={`/v1/admin/audit-exports/${encodeURIComponent(row.id)}/download`} download>Download {row.day} payload</a>
    <details><summary>Verification metadata for {row.day}</summary><pre className={s.metadata}>{JSON.stringify(row.envelope,null,2)}</pre><p>Public key here is information, not independent approval. Verify canonical payload hashes, signatures, coverage start, date adjacency, and prior envelope hash offline.</p></details>
   </>}
  </li>)}</ul>
 </section>;
}
