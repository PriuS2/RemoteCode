from __future__ import annotations

import os
import shutil
from dataclasses import dataclass


@dataclass(frozen=True)
class LanguageDescriptor:
    language_id: str
    label: str
    transport: str
    extensions: tuple[str, ...]
    command: tuple[str, ...] | None = None
    detail: str | None = None

    def availability(self) -> tuple[bool, str | None]:
        if self.transport != "lsp" or not self.command:
            return True, self.detail or self.default_detail()

        executable = self.command[0]
        if shutil.which(executable):
            return True, self.detail or self.default_detail()
        return False, f"{executable} is not installed."

    def default_detail(self) -> str:
        if self.transport == "native":
            return "Built-in Monaco language features."
        if self.transport == "syntax":
            return "Syntax highlighting only."
        return "Language server support."


LANGUAGE_DESCRIPTORS: tuple[LanguageDescriptor, ...] = (
    LanguageDescriptor("typescript", "TypeScript", "native", (".ts", ".tsx")),
    LanguageDescriptor("javascript", "JavaScript", "native", (".js", ".jsx", ".mjs", ".cjs")),
    LanguageDescriptor("json", "JSON", "native", (".json", ".jsonc")),
    LanguageDescriptor("html", "HTML", "native", (".html", ".htm")),
    LanguageDescriptor("css", "CSS", "native", (".css",)),
    LanguageDescriptor("scss", "SCSS", "native", (".scss",)),
    LanguageDescriptor("less", "Less", "native", (".less",)),
    LanguageDescriptor(
        "csharp",
        "C#",
        "lsp",
        (".cs", ".csx"),
        command=("csharp-ls",),
        detail="Uses csharp-ls over stdio.",
    ),
    LanguageDescriptor(
        "go",
        "Go",
        "lsp",
        (".go",),
        command=("gopls",),
        detail="Uses gopls over stdio.",
    ),
    LanguageDescriptor("java", "Java", "syntax", (".java",)),
    LanguageDescriptor("rust", "Rust", "syntax", (".rs",)),
    LanguageDescriptor("shell", "Shell", "syntax", (".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd")),
    LanguageDescriptor("sql", "SQL", "syntax", (".sql",)),
    LanguageDescriptor("xml", "XML", "syntax", (".xml", ".xsd", ".xsl", ".svg")),
    LanguageDescriptor("cpp", "C/C++", "syntax", (".c", ".cc", ".cpp", ".cxx", ".h", ".hpp")),
    LanguageDescriptor(
        "python",
        "Python",
        "lsp",
        (".py", ".pyi", ".pyw"),
        command=("pyright-langserver", "--stdio"),
        detail="Uses pyright-langserver over stdio.",
    ),
    LanguageDescriptor("markdown", "Markdown", "syntax", (".md", ".markdown")),
    LanguageDescriptor("yaml", "YAML", "syntax", (".yaml", ".yml")),
    LanguageDescriptor("plaintext", "Plain Text", "syntax", (".txt", ".log", ".env")),
)


LANGUAGE_BY_ID = {descriptor.language_id: descriptor for descriptor in LANGUAGE_DESCRIPTORS}

EXTENSION_TO_LANGUAGE: dict[str, str] = {}
for descriptor in LANGUAGE_DESCRIPTORS:
    for extension in descriptor.extensions:
        EXTENSION_TO_LANGUAGE[extension.lower()] = descriptor.language_id


SPECIAL_FILENAMES = {
    "dockerfile": "plaintext",
    "makefile": "plaintext",
}


def detect_language_id(path: str) -> str:
    name = os.path.basename(path).lower()
    if name in SPECIAL_FILENAMES:
        return SPECIAL_FILENAMES[name]

    extension = os.path.splitext(name)[1].lower()
    return EXTENSION_TO_LANGUAGE.get(extension, "plaintext")


def get_language_descriptor(language_id: str) -> LanguageDescriptor | None:
    return LANGUAGE_BY_ID.get(language_id)


def list_language_statuses() -> list[dict]:
    statuses: list[dict] = []
    for descriptor in LANGUAGE_DESCRIPTORS:
        available, detail = descriptor.availability()
        statuses.append({
            "language_id": descriptor.language_id,
            "label": descriptor.label,
            "transport": descriptor.transport,
            "available": available,
            "detail": detail,
            "extensions": list(descriptor.extensions),
        })
    return statuses
