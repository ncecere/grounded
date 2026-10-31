import { expect, test } from "./support/fixtures";

test("signed exports: real off/key-error state, 390px keyboard and auditor facts",async({as,a11y},info)=>{
 const page=await as("admin");
 await page.setViewportSize({width:390,height:844});
 await page.goto("/admin/logs");
 const panel=page.getByRole("region",{name:"Signed daily exports"});
 await expect(panel.getByText(/Off — no daily exports approved/)).toBeVisible();
 await expect(panel.getByText(/Unavailable — an operator/)).toBeVisible();
 const approval=panel.getByRole("button",{name:"Approve daily exports"});
 await approval.focus();
 await page.keyboard.press("Enter");
 await expect(panel.getByRole("alert")).toContainText("Private signed export configuration is unavailable");
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
