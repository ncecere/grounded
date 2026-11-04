import { AccessibilityLinks } from "./accessibility-links";
import { useInstance } from "../session";
import c from "./accessibility.module.css";

export function AccessibilityPage() {
  const instance = useInstance();
  return <main className={c.page}>
    <h1>Accessibility statement</h1>
    <p>{instance.name} targets WCAG 2.1 Level AA. This is a target, not a certification or a claim of full conformance.</p>
    <h2>Testing and evidence</h2>
    <p>Every release of Grounded runs automated axe checks on its pages in unit and browser tests, checks keyboard use of dialogs and menus, and checks pages at phone widths. Automated checks find only some accessibility barriers, and a passing check is not a manual audit.</p>
    <p>This statement does not claim that this installation, the content its teams add, or every browser and assistive technology combination has been audited by hand. Ask the operator of this installation for its own testing evidence.</p>
    <h2>Known limitations</h2>
    <p>Generated answers and uploaded source documents may have accessibility problems. Source formatting and model-generated content are not guaranteed accessible. Streaming answers, embedded widgets, keyboard navigation and screen-reader use need continued manual testing; Grounded has not yet had an independent screen-reader audit.</p>
    <h2>Report an accessibility problem</h2>
    <p>Include the page address, what you were trying to do, and your browser and assistive technology if you are comfortable sharing them. Do not include private conversations or sensitive information.</p>
    <AccessibilityLinks />
  </main>;
}
