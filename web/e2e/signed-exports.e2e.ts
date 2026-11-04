import { expect, test } from "./support/fixtures";

test("signed exports: real off/key-error state, 390px keyboard and auditor facts",async({as,a11y},info)=>{
 const page=await as("admin");
 await page.setViewportSize({width:390,height:844});
 await page.goto("/admin/logs");
 const panel=page.getByRole("region",{name:"Signed daily exports"});
 await expect(panel.getByText("Off", { exact: true })).toBeVisible();
 await expect(panel.getByText(/Unavailable: an operator must configure/)).toBeVisible();
 // Without the operator's signing key there is nothing to approve: the button says so by being disabled.
 await expect(panel.getByRole("button",{name:"Approve daily exports"})).toBeDisabled();
 await panel.getByLabel("First covered UTC day").focus();
 await expect(panel.getByLabel("First covered UTC day")).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await a11y(page);
 await page.screenshot({path:info.outputPath("signed-exports-admin-390.png"),fullPage:true});
 const auditor=await as("auditor");
 await auditor.setViewportSize({width:390,height:844});
 await auditor.goto("/admin/logs");
 const facts=auditor.getByRole("region",{name:"Signed daily exports"});
 await expect(facts.getByText(/Coverage starts/)).toBeVisible();
 await expect(facts.getByRole("button",{name:"Approve daily exports"})).toHaveCount(0);
 await expect(facts.getByLabel("First covered UTC day")).toHaveCount(0);
 await a11y(auditor);
 await auditor.screenshot({path:info.outputPath("signed-exports-auditor-390.png"),fullPage:true});
});
