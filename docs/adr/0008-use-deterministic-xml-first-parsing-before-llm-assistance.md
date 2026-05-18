# Use deterministic XML-first parsing before LLM assistance

The MVP uses deterministic XML/Formex-first parsing, with text fallback rules, before introducing LLM-assisted extraction. LLM assistance may be added behind a parser interface later, but starting with deterministic parsing gives stronger reproducibility, fixture-based tests, and audit confidence while the sanctions delta workflow is being established.
