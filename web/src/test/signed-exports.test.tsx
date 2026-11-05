import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SignedExports, copyText } from "../pages/admin/logs/signed-exports";
import { mockApi } from "./harness";

const role=vi.hoisted(()=>({admin:true}));
vi.mock("../pages/admin/hooks",()=>({useIsPlatformAdmin:()=>role.admin}));
afterEach(()=>{vi.unstubAllGlobals();role.admin=true;});
const cfg={enabled:false,coverageStart:"2026-01-01",destination:"builtin",revision:3,keyReady:false,keyId:"",externalCopy:{configured:false,bucket:"",prefix:""}};
function view(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SignedExports/></QueryClientProvider>);}
it("cannot approve without the operator's signing key",async()=>{
 mockApi({"GET /v1/admin/audit-export-settings":()=>cfg,"GET /v1/admin/audit-exports":()=>[]});
 view();
 await screen.findByText(/Unavailable: an operator must configure/);
 expect(screen.getByRole("button",{name:"Approve daily exports"})).toBeDisabled();
});
it("does no work on mount; explicit admin approval carries revision; keyboard and axe",async()=>{
 const calls=mockApi({
 "GET /v1/admin/audit-export-settings":()=>({...cfg,keyReady:true,keyId:"a96ee895"}),
 "GET /v1/admin/audit-exports":()=>[],
 "PUT /v1/admin/audit-export-settings":()=>new Response(JSON.stringify({error:{code:"audit_export_unavailable",message:"Private signed export configuration is unavailable"}}),{status:503,headers:{"Content-Type":"application/json"}})
 });
 const {container}=view();
 await screen.findByText("a96ee895");
 expect(calls.every(c=>c.method==="GET")).toBe(true);
 expect(screen.getByLabelText("First covered UTC day")).toHaveValue("2026-01-01");
 screen.getByRole("button",{name:"Approve daily exports"}).focus();
 await userEvent.keyboard("{Enter}");
 await screen.findByRole("alert");
 expect(screen.getByRole("alert")).toHaveTextContent("Private signed export configuration is unavailable");
 const put=calls.find(c=>c.method==="PUT")!;
 expect(put.headers.get("If-Match")).toBe('"3"');
 expect(put.body).toEqual({enabled:true,coverageStart:"2026-01-01",destination:"builtin"});
 expect(await axe(container)).toHaveNoViolations();
});
it("auditors see semantic facts and safe download, not a disabled editor",async()=>{
 role.admin=false;
 const calls=mockApi({
 "GET /v1/admin/audit-export-settings":()=>cfg,
 "GET /v1/admin/audit-exports":()=>[{id:"00000000-0000-0000-0000-000000000039",day:"2026-01-01",state:"completed",revision:2,failureCode:"",envelope:{manifest:{coverageStart:"2026-01-01"}}}]
 });
 const {container}=view();
 const link=await screen.findByRole("link",{name:"Download the 2026-01-01 export"});
 expect(link).toHaveAttribute("href","/v1/admin/audit-exports/00000000-0000-0000-0000-000000000039/download");
 expect(screen.queryByLabelText("First covered UTC day")).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Create daily export"})).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole("button",{name:/Verification for 2026-01-01/}));
 expect(screen.getByText(/The public key here is information/)).toBeVisible();
 await waitFor(()=>expect(calls.every(c=>c.method==="GET")).toBe(true));
 expect(await axe(container)).toHaveNoViolations();
});

it("shows the external copy bucket and each day's copy state",async()=>{
 expect(copyText({state:"completed",copiedAt:null,copyErrorClass:"write"},true)).toBe("Retrying: the bucket refused it");
 expect(copyText({state:"completed",copiedAt:"2026-11-05T10:00:00Z",copyErrorClass:""},false)).toBe("—");
 const day=(d:string,extra:object)=>({id:d,day:d,state:"completed",revision:1,failureCode:"",envelope:{},...extra});
 mockApi({"GET /v1/admin/audit-export-settings":()=>({...cfg,enabled:true,keyReady:true,keyId:"a96ee895",externalCopy:{configured:true,bucket:"audit-archive",prefix:"grounded/"}}),
  "GET /v1/admin/audit-exports":()=>[day("2026-11-04",{copiedAt:"2026-11-05T00:10:00Z",copyErrorClass:""}),day("2026-11-03",{copiedAt:null,copyErrorClass:"verify"})]});
 const {container}=view();
 expect(await screen.findByText(/s3:\/\/audit-archive\/grounded\/audit-exports/)).toBeInTheDocument();
 expect(await screen.findByText("Copied")).toBeInTheDocument();
 expect(screen.getByText("Retrying: the bucket returned other bytes")).toBeInTheDocument();
 expect(await axe(container)).toHaveNoViolations();
});
