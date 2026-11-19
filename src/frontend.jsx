import React, { Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import parse, { attributesToProps, domToReact } from "html-react-parser";

const roots = new WeakMap();
const templateOptions = {
  replace(node) {
    if (node.name === "select") {
      const options = node.children.filter(child => child.name === "option");
      const selected = options.find(option => Object.hasOwn(option.attribs, "selected"));
      return <select {...attributesToProps(node.attribs)} defaultValue={selected?.attribs.value ?? selected?.children[0]?.data}>
        {domToReact(node.children, templateOptions)}
      </select>;
    }
    if (node.name === "option" && Object.hasOwn(node.attribs, "selected")) {
      const { selected, ...attributes } = node.attribs;
      void selected;
      return <option {...attributesToProps(attributes)}>{domToReact(node.children, templateOptions)}</option>;
    }
  }
};

function OfflineNotice() {
  return <div className="status-banner">Offline · Saved pages and local video files are available.</div>;
}

function Screen({ markup, offline }) {
  return <>
    {offline && <OfflineNotice />}
    {parse(markup, templateOptions)}
  </>;
}

function commit(container, children) {
  let entry = roots.get(container);
  if (!entry) {
    entry = { root: createRoot(container), revision: 0 };
    roots.set(container, entry);
  }
  // Reset browser-owned media and focus when the route is rendered again.
  flushSync(() => entry.root.render(<Fragment key={++entry.revision}>{children}</Fragment>));
}

export function mountScreen(container, markup, offline) {
  commit(container, <Screen markup={markup} offline={offline} />);
}

export function mountDialog(container, title, markup) {
  commit(container, <>
    <div className="sheet-header">
      <h2 id="sheet-title">{title}</h2>
      <button className="sheet-close" data-action="close-sheet" aria-label="Close dialog">×</button>
    </div>
    <div className="sheet-body">{parse(markup, templateOptions)}</div>
  </>);
}
