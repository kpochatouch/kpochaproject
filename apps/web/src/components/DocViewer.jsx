import React from "react";
import { useParams, Link } from "react-router-dom";
import { marked } from "marked";

import termsMd from "../../../../docs/terms-and-conditions.md?raw";
import privacyMd from "../../../../docs/privacy-policy.md?raw";
import proGuideMd from "../../../../docs/professional-guide.md?raw";
import userGuideMd from "../../../../docs/user-guide.md?raw";
import faqMd from "../../../../docs/faq.md?raw";

const DOC_MAP = {
  "terms-and-conditions": {
    title: "Terms & Conditions",
    content: termsMd,
  },
  "privacy-policy": {
    title: "Privacy Policy",
    content: privacyMd,
  },
  "professional-guide": {
    title: "Professional Guide",
    content: proGuideMd,
  },
  "user-guide": {
    title: "User Guide",
    content: userGuideMd,
  },
  faq: {
    title: "FAQ",
    content: faqMd,
  },
};

export default function DocViewer() {
  const { slug } = useParams();

  if (!slug) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold mb-4">Documentation</h2>
        <p className="text-sm text-zinc-400 mb-4">Select a document to view.</p>
        <ul className="list-disc pl-5">
          {Object.keys(DOC_MAP).map((k) => (
            <li key={k}>
              <Link to={`/docs/${k}`} className="text-gold underline">
                {DOC_MAP[k].title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const doc = DOC_MAP[slug];
  if (!doc) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold mb-4">Document not found</h2>
        <p className="text-sm text-zinc-400">No document matches "{slug}"</p>
        <div className="mt-4">
          <Link to="/docs" className="text-gold underline">
            Back to docs
          </Link>
        </div>
      </div>
    );
  }

  const html = marked.parse(doc.content || "");

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-semibold mb-6 text-gold">{doc.title}</h1>
      <div
        className="prose max-w-full text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="mt-8">
        <Link to="/docs" className="text-gold underline">
          Back to docs
        </Link>
      </div>
    </div>
  );
}
