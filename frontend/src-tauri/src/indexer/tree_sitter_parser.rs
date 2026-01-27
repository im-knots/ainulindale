//! Tree-sitter based parsing for syntax-aware code chunking
//!
//! Provides parsers for multiple languages and extracts semantic units
//! (functions, classes, structs, etc.) as chunks for embedding.

use tree_sitter::{Language, Parser, Node, Tree};

/// Supported languages for tree-sitter parsing
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportedLanguage {
    Rust,
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Go,
}

impl SupportedLanguage {
    /// Get the tree-sitter Language for this language
    pub fn tree_sitter_language(&self) -> Language {
        match self {
            SupportedLanguage::Rust => tree_sitter_rust::LANGUAGE.into(),
            SupportedLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            SupportedLanguage::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            SupportedLanguage::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            SupportedLanguage::Python => tree_sitter_python::LANGUAGE.into(),
            SupportedLanguage::Go => tree_sitter_go::LANGUAGE.into(),
        }
    }

    /// Get the node kinds that represent top-level declarations for this language
    pub fn top_level_kinds(&self) -> &'static [&'static str] {
        match self {
            SupportedLanguage::Rust => &[
                "function_item",
                "impl_item",
                "struct_item",
                "enum_item",
                "trait_item",
                "mod_item",
                "const_item",
                "static_item",
                "type_item",
                "macro_definition",
            ],
            SupportedLanguage::TypeScript | SupportedLanguage::Tsx => &[
                "function_declaration",
                "class_declaration",
                "interface_declaration",
                "type_alias_declaration",
                "enum_declaration",
                "export_statement",
                "lexical_declaration", // const/let at top level
                "variable_declaration",
            ],
            SupportedLanguage::JavaScript => &[
                "function_declaration",
                "class_declaration",
                "export_statement",
                "lexical_declaration",
                "variable_declaration",
            ],
            SupportedLanguage::Python => &[
                "function_definition",
                "class_definition",
                "decorated_definition",
            ],
            SupportedLanguage::Go => &[
                "function_declaration",
                "method_declaration",
                "type_declaration",
                "const_declaration",
                "var_declaration",
            ],
        }
    }

    /// Detect language from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "rs" => Some(SupportedLanguage::Rust),
            "ts" => Some(SupportedLanguage::TypeScript),
            "tsx" => Some(SupportedLanguage::Tsx),
            "js" | "mjs" | "cjs" => Some(SupportedLanguage::JavaScript),
            "jsx" => Some(SupportedLanguage::JavaScript), // JSX uses JS parser
            "py" => Some(SupportedLanguage::Python),
            "go" => Some(SupportedLanguage::Go),
            _ => None,
        }
    }

    /// Get the language name as a string
    pub fn name(&self) -> &'static str {
        match self {
            SupportedLanguage::Rust => "rust",
            SupportedLanguage::TypeScript => "typescript",
            SupportedLanguage::Tsx => "tsx",
            SupportedLanguage::JavaScript => "javascript",
            SupportedLanguage::Python => "python",
            SupportedLanguage::Go => "go",
        }
    }
}

/// A parsed syntax tree with its source
pub struct ParsedSource {
    pub tree: Tree,
    pub source: String,
    pub language: SupportedLanguage,
}

/// A semantic unit extracted from the syntax tree
#[derive(Debug, Clone)]
pub struct SemanticUnit {
    /// The kind of node (e.g., "function_item", "class_declaration")
    pub kind: String,
    /// Start byte offset in the source
    pub start_byte: usize,
    /// End byte offset in the source
    pub end_byte: usize,
    /// Start line (0-indexed)
    pub start_line: usize,
    /// End line (0-indexed)
    pub end_line: usize,
    /// The content of this unit
    pub content: String,
    /// Optional name of the unit (function name, class name, etc.)
    pub name: Option<String>,
}

/// Parse source code with tree-sitter
pub fn parse_source(source: &str, language: SupportedLanguage) -> Option<ParsedSource> {
    let mut parser = Parser::new();
    parser.set_language(&language.tree_sitter_language()).ok()?;

    let tree = parser.parse(source, None)?;

    Some(ParsedSource {
        tree,
        source: source.to_string(),
        language,
    })
}

/// Extract semantic units (functions, classes, etc.) from a parsed syntax tree
pub fn extract_semantic_units(parsed: &ParsedSource) -> Vec<SemanticUnit> {
    let mut units = Vec::new();
    let root_node = parsed.tree.root_node();
    let top_level_kinds = parsed.language.top_level_kinds();

    // Walk the tree and extract top-level declarations
    let mut cursor = root_node.walk();
    for child in root_node.children(&mut cursor) {
        collect_semantic_units(&child, &parsed.source, top_level_kinds, &mut units);
    }

    units
}

/// Recursively collect semantic units from a node
fn collect_semantic_units(
    node: &Node,
    source: &str,
    top_level_kinds: &[&str],
    units: &mut Vec<SemanticUnit>,
) {
    // Check if this node is a top-level declaration
    if top_level_kinds.contains(&node.kind()) {
        let content = &source[node.byte_range()];
        let name = extract_name(node, source);

        units.push(SemanticUnit {
            kind: node.kind().to_string(),
            start_byte: node.start_byte(),
            end_byte: node.end_byte(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            content: content.to_string(),
            name,
        });
        return; // Don't recurse into top-level declarations
    }

    // Recurse into children (e.g., to find decorated functions in Python)
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_semantic_units(&child, source, top_level_kinds, units);
    }
}

/// Extract the name of a semantic unit (function name, class name, etc.)
fn extract_name(node: &Node, source: &str) -> Option<String> {
    // Look for identifier or name child nodes
    let name_field_names = ["name", "identifier"];

    for field_name in name_field_names {
        if let Some(name_node) = node.child_by_field_name(field_name) {
            return Some(source[name_node.byte_range()].to_string());
        }
    }

    // Fallback: look for first identifier child
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "identifier" || child.kind() == "name" {
            return Some(source[child.byte_range()].to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rust_functions() {
        let source = r#"
fn hello() {
    println!("Hello");
}

fn world() {
    println!("World");
}
"#;
        let parsed = parse_source(source, SupportedLanguage::Rust).unwrap();
        let units = extract_semantic_units(&parsed);

        assert_eq!(units.len(), 2);
        assert_eq!(units[0].kind, "function_item");
        assert!(units[0].content.contains("hello"));
        assert_eq!(units[0].name, Some("hello".to_string()));
        assert_eq!(units[1].kind, "function_item");
        assert!(units[1].content.contains("world"));
        assert_eq!(units[1].name, Some("world".to_string()));
    }

    #[test]
    fn test_parse_typescript_class() {
        let source = r#"
class MyClass {
    constructor() {}
    myMethod() {
        return 1;
    }
}

function standalone() {
    return 2;
}
"#;
        let parsed = parse_source(source, SupportedLanguage::TypeScript).unwrap();
        let units = extract_semantic_units(&parsed);

        assert_eq!(units.len(), 2);
        assert_eq!(units[0].kind, "class_declaration");
        assert!(units[0].content.contains("MyClass"));
        assert_eq!(units[1].kind, "function_declaration");
        assert!(units[1].content.contains("standalone"));
    }

    #[test]
    fn test_parse_python_class_and_function() {
        let source = r#"
class MyClass:
    def __init__(self):
        pass

def standalone():
    return 1
"#;
        let parsed = parse_source(source, SupportedLanguage::Python).unwrap();
        let units = extract_semantic_units(&parsed);

        assert_eq!(units.len(), 2);
        assert_eq!(units[0].kind, "class_definition");
        assert_eq!(units[1].kind, "function_definition");
    }

    #[test]
    fn test_parse_go_functions() {
        let source = r#"
func Hello() {
    fmt.Println("Hello")
}

func (s *Server) Start() error {
    return nil
}
"#;
        let parsed = parse_source(source, SupportedLanguage::Go).unwrap();
        let units = extract_semantic_units(&parsed);

        assert_eq!(units.len(), 2);
        assert_eq!(units[0].kind, "function_declaration");
        assert_eq!(units[1].kind, "method_declaration");
    }

    #[test]
    fn test_from_extension() {
        assert_eq!(SupportedLanguage::from_extension("rs"), Some(SupportedLanguage::Rust));
        assert_eq!(SupportedLanguage::from_extension("ts"), Some(SupportedLanguage::TypeScript));
        assert_eq!(SupportedLanguage::from_extension("tsx"), Some(SupportedLanguage::Tsx));
        assert_eq!(SupportedLanguage::from_extension("py"), Some(SupportedLanguage::Python));
        assert_eq!(SupportedLanguage::from_extension("go"), Some(SupportedLanguage::Go));
        assert_eq!(SupportedLanguage::from_extension("unknown"), None);
    }
}

