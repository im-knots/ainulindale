use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Error type for command operations
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Shell command failed: {0}")]
    ShellFailed(String),
    #[error("Path error: {0}")]
    PathError(String),
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Result of shell command execution
#[derive(Debug, Serialize, Deserialize)]
pub struct ShellResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Event sent during shell execution for streaming output
#[derive(Debug, Clone, Serialize)]
pub enum ShellEvent {
    Stdout(String),
    Stderr(String),
    Exit(i32),
}

/// Execute a shell command with optional streaming output
#[tauri::command]
pub async fn execute_shell(
    command: String,
    cwd: Option<String>,
    on_event: Channel<ShellEvent>,
) -> Result<ShellResult, CommandError> {
    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "bash"
    };
    let shell_arg = if cfg!(target_os = "windows") {
        "/C"
    } else {
        "-c"
    };

    let working_dir = cwd.unwrap_or_else(|| ".".to_string());

    let mut child = Command::new(shell)
        .arg(shell_arg)
        .arg(&command)
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    // Stream stdout
    let on_event_clone = on_event.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut buf = String::new();
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            let _ = on_event_clone.send(ShellEvent::Stdout(line.clone()));
            buf.push_str(&line);
            buf.push('\n');
        }
        buf
    });

    // Stream stderr
    let on_event_clone = on_event.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut buf = String::new();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            let _ = on_event_clone.send(ShellEvent::Stderr(line.clone()));
            buf.push_str(&line);
            buf.push('\n');
        }
        buf
    });

    // Wait for all streams and the process
    stdout_buf = stdout_handle.await.unwrap_or_default();
    stderr_buf = stderr_handle.await.unwrap_or_default();

    let status = child.wait().await?;
    let exit_code = status.code().unwrap_or(-1);

    let _ = on_event.send(ShellEvent::Exit(exit_code));

    Ok(ShellResult {
        exit_code,
        stdout: stdout_buf,
        stderr: stderr_buf,
    })
}

/// Read a file's contents
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, CommandError> {
    let contents = tokio::fs::read_to_string(&path).await?;
    Ok(contents)
}

/// Write contents to a file
#[tauri::command]
pub async fn write_file(path: String, contents: String) -> Result<(), CommandError> {
    // Create parent directories if they don't exist
    if let Some(parent) = PathBuf::from(&path).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, contents).await?;
    Ok(())
}

/// Directory entry information
#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
}

/// List directory contents
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<DirEntry>, CommandError> {
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&path).await?;

    while let Some(entry) = dir.next_entry().await? {
        let metadata = entry.metadata().await?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
            size: metadata.len(),
        });
    }

    Ok(entries)
}

/// Check if a file or directory exists
#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, CommandError> {
    Ok(tokio::fs::try_exists(&path).await?)
}

/// Delete a file
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), CommandError> {
    tokio::fs::remove_file(&path).await?;
    Ok(())
}

/// Delete a directory (recursive)
#[tauri::command]
pub async fn delete_directory(path: String) -> Result<(), CommandError> {
    tokio::fs::remove_dir_all(&path).await?;
    Ok(())
}

/// Copy a file
#[tauri::command]
pub async fn copy_file(source: String, destination: String) -> Result<u64, CommandError> {
    // Create parent directories if they don't exist
    if let Some(parent) = PathBuf::from(&destination).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let bytes_copied = tokio::fs::copy(&source, &destination).await?;
    Ok(bytes_copied)
}

/// Move/rename a file or directory
#[tauri::command]
pub async fn move_file(source: String, destination: String) -> Result<(), CommandError> {
    // Create parent directories if they don't exist
    if let Some(parent) = PathBuf::from(&destination).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::rename(&source, &destination).await?;
    Ok(())
}

/// Create a directory (with parents)
#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), CommandError> {
    tokio::fs::create_dir_all(&path).await?;
    Ok(())
}

/// File metadata information
#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub readonly: bool,
}

/// Get file/directory metadata
#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileInfo, CommandError> {
    let path_buf = PathBuf::from(&path);

    if !tokio::fs::try_exists(&path).await? {
        return Ok(FileInfo {
            path,
            exists: false,
            is_file: false,
            is_dir: false,
            size: 0,
            modified: None,
            created: None,
            readonly: false,
        });
    }

    let metadata = tokio::fs::metadata(&path_buf).await?;

    let modified = metadata.modified().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
    });

    let created = metadata.created().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
    });

    Ok(FileInfo {
        path,
        exists: true,
        is_file: metadata.is_file(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified,
        created,
        readonly: metadata.permissions().readonly(),
    })
}

/// System information
#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub home_dir: Option<String>,
    pub current_dir: Option<String>,
}

/// Get system information
#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        home_dir: home_dir().map(|p| p.to_string_lossy().to_string()),
        current_dir: std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

/// Get the user's home directory
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}
