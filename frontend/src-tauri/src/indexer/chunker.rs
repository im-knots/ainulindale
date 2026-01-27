//! Code chunking for embedding generation
//!
//! Splits source files into semantic chunks suitable for embedding.
//! Uses tree-sitter for syntax-aware chunking when available, falling back to line-based chunking.

use super::tree_sitter_parser::{SupportedLanguage, parse_source, extract_semantic_units};
use super::{CodeChunk, IndexerConfig};
use std::path::Path;
use uuid::Uuid;

/// Chunk a file's content into code chunks for embedding
///
/// Uses tree-sitter for syntax-aware chunking when the language is supported,
/// falling back to line-based chunking for unsupported languages or parse failures.
pub fn chunk_file(
    filesystem_hex_id: &str,
    file_path: &str,
    content: &str,
    config: &IndexerConfig,
) -> Vec<CodeChunk> {
    if content.is_empty() {
        return vec![];
    }

    // Try tree-sitter based chunking first
    if let Some(language) = detect_supported_language(file_path) {
        if let Some(chunks) = chunk_file_tree_sitter(filesystem_hex_id, file_path, content, language, config) {
            if !chunks.is_empty() {
                return chunks;
            }
        }
    }

    // Fallback to line-based chunking
    chunk_file_line_based(filesystem_hex_id, file_path, content, config)
}

/// Chunk a file using tree-sitter syntax-aware parsing
fn chunk_file_tree_sitter(
    filesystem_hex_id: &str,
    file_path: &str,
    content: &str,
    language: SupportedLanguage,
    config: &IndexerConfig,
) -> Option<Vec<CodeChunk>> {
    let parsed = parse_source(content, language)?;
    let units = extract_semantic_units(&parsed);

    if units.is_empty() {
        return None;
    }

    let mut chunks = Vec::new();
    let language_name = Some(language.name().to_string());

    for unit in units {
        let line_count = unit.end_line - unit.start_line + 1;

        // If unit is small enough, create a single chunk
        if line_count <= config.max_chunk_lines {
            chunks.push(CodeChunk {
                id: Uuid::new_v4().to_string(),
                filesystem_hex_id: filesystem_hex_id.to_string(),
                file_path: file_path.to_string(),
                start_line: (unit.start_line + 1) as u32, // Convert to 1-indexed
                end_line: (unit.end_line + 1) as u32,
                content: unit.content,
                language: language_name.clone(),
            });
        } else {
            // For very large units, split into overlapping chunks
            let unit_lines: Vec<&str> = unit.content.lines().collect();
            let step = config.max_chunk_lines.saturating_sub(config.overlap_lines).max(1);
            let mut start = 0;

            while start < unit_lines.len() {
                let end = (start + config.max_chunk_lines).min(unit_lines.len());

                if end - start < config.min_chunk_lines && !chunks.is_empty() {
                    break;
                }

                let chunk_content = unit_lines[start..end].join("\n");

                chunks.push(CodeChunk {
                    id: Uuid::new_v4().to_string(),
                    filesystem_hex_id: filesystem_hex_id.to_string(),
                    file_path: file_path.to_string(),
                    start_line: (unit.start_line + start + 1) as u32,
                    end_line: (unit.start_line + end) as u32,
                    content: chunk_content,
                    language: language_name.clone(),
                });

                if end >= unit_lines.len() {
                    break;
                }

                start += step;
            }
        }
    }

    Some(chunks)
}

/// Chunk a file using line-based splitting (fallback)
fn chunk_file_line_based(
    filesystem_hex_id: &str,
    file_path: &str,
    content: &str,
    config: &IndexerConfig,
) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();

    if total_lines == 0 {
        return vec![];
    }

    let language = detect_language(file_path);
    let mut chunks = Vec::new();

    // For small files, create a single chunk
    if total_lines <= config.max_chunk_lines {
        chunks.push(CodeChunk {
            id: Uuid::new_v4().to_string(),
            filesystem_hex_id: filesystem_hex_id.to_string(),
            file_path: file_path.to_string(),
            start_line: 1,
            end_line: total_lines as u32,
            content: content.to_string(),
            language: language.clone(),
        });
        return chunks;
    }

    // For larger files, create overlapping chunks
    let step = config.max_chunk_lines.saturating_sub(config.overlap_lines).max(1);
    let mut start = 0;

    while start < total_lines {
        let end = (start + config.max_chunk_lines).min(total_lines);

        // Skip if chunk would be too small (unless it's the last chunk)
        if end - start < config.min_chunk_lines && !chunks.is_empty() {
            break;
        }

        let chunk_content = lines[start..end].join("\n");

        chunks.push(CodeChunk {
            id: Uuid::new_v4().to_string(),
            filesystem_hex_id: filesystem_hex_id.to_string(),
            file_path: file_path.to_string(),
            start_line: (start + 1) as u32, // 1-indexed
            end_line: end as u32,           // 1-indexed, inclusive
            content: chunk_content,
            language: language.clone(),
        });

        if end >= total_lines {
            break;
        }

        start += step;
    }

    chunks
}

/// Detect if a file has a language supported by tree-sitter
fn detect_supported_language(file_path: &str) -> Option<SupportedLanguage> {
    let path = Path::new(file_path);
    path.extension()
        .and_then(|ext| ext.to_str())
        .and_then(SupportedLanguage::from_extension)
}

/// Detect language from file extension
fn detect_language(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext.to_lowercase().as_str() {
            "rs" => "rust",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "go" => "go",
            "java" => "java",
            "c" | "h" => "c",
            "cpp" | "hpp" | "cc" | "cxx" => "cpp",
            "cs" => "csharp",
            "rb" => "ruby",
            "php" => "php",
            "swift" => "swift",
            "kt" => "kotlin",
            "scala" => "scala",
            "sql" => "sql",
            "sh" | "bash" | "zsh" => "shell",
            "yaml" | "yml" => "yaml",
            "json" => "json",
            "toml" => "toml",
            "xml" => "xml",
            "html" => "html",
            "css" | "scss" => "css",
            "md" => "markdown",
            _ => ext,
        })
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_small_file() {
        let config = IndexerConfig::default();
        let content = "line 1\nline 2\nline 3";
        let chunks = chunk_file("hex-1", "test.txt", content, &config);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 3);
    }

    #[test]
    fn test_detect_language() {
        assert_eq!(detect_language("foo.rs"), Some("rust".to_string()));
        assert_eq!(detect_language("bar.ts"), Some("typescript".to_string()));
        assert_eq!(detect_language("baz.py"), Some("python".to_string()));
    }

    #[test]
    fn test_chunk_rust_with_tree_sitter() {
        let config = IndexerConfig::default();
        let content = r#"
fn foo() {
    println!("foo");
}

fn bar() {
    println!("bar");
}

struct MyStruct {
    field: i32,
}
"#;
        let chunks = chunk_file("hex-1", "test.rs", content, &config);

        // Should create 3 chunks: 2 functions + 1 struct
        assert_eq!(chunks.len(), 3);
        assert!(chunks[0].content.contains("foo"));
        assert!(chunks[1].content.contains("bar"));
        assert!(chunks[2].content.contains("MyStruct"));
        assert_eq!(chunks[0].language, Some("rust".to_string()));
    }

    #[test]
    fn test_chunk_typescript_with_tree_sitter() {
        let config = IndexerConfig::default();
        let content = r#"
function hello() {
    console.log("hello");
}

class MyClass {
    constructor() {}
}
"#;
        let chunks = chunk_file("hex-1", "test.ts", content, &config);

        // Should create 2 chunks: function + class
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].content.contains("hello"));
        assert!(chunks[1].content.contains("MyClass"));
        assert_eq!(chunks[0].language, Some("typescript".to_string()));
    }

    #[test]
    fn test_chunk_python_with_tree_sitter() {
        let config = IndexerConfig::default();
        let content = r#"
def hello():
    print("hello")

class MyClass:
    def __init__(self):
        pass
"#;
        let chunks = chunk_file("hex-1", "test.py", content, &config);

        // Should create 2 chunks: function + class
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].content.contains("hello"));
        assert!(chunks[1].content.contains("MyClass"));
        assert_eq!(chunks[0].language, Some("python".to_string()));
    }

    #[test]
    fn test_chunk_unsupported_language_uses_line_based() {
        let config = IndexerConfig::default();
        let content = "line 1\nline 2\nline 3";
        // .txt is not a supported tree-sitter language
        let chunks = chunk_file("hex-1", "test.txt", content, &config);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].language, Some("txt".to_string()));
    }

    #[test]
    fn test_chunk_empty_file() {
        let config = IndexerConfig::default();
        let chunks = chunk_file("hex-1", "test.rs", "", &config);
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_detect_supported_language() {
        assert_eq!(detect_supported_language("test.rs"), Some(SupportedLanguage::Rust));
        assert_eq!(detect_supported_language("test.ts"), Some(SupportedLanguage::TypeScript));
        assert_eq!(detect_supported_language("test.tsx"), Some(SupportedLanguage::Tsx));
        assert_eq!(detect_supported_language("test.py"), Some(SupportedLanguage::Python));
        assert_eq!(detect_supported_language("test.go"), Some(SupportedLanguage::Go));
        assert_eq!(detect_supported_language("test.js"), Some(SupportedLanguage::JavaScript));
        assert_eq!(detect_supported_language("test.txt"), None);
        assert_eq!(detect_supported_language("test.java"), None);
    }
}

