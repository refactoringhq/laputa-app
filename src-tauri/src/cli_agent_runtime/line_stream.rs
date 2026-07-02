use crate::ai_agents::AiAgentStreamEvent;
use regex::Regex;
use std::io::{BufRead, Read, Write};
use std::process::{ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus};

pub(crate) struct LineStreamProcess {
    command: Command,
    process_name: &'static str,
    session_prefix: &'static str,
    stdin_input: Option<String>,
}

struct LineStreamRun {
    session_id: String,
    stderr_output: String,
    status: ExitStatus,
}

impl LineStreamProcess {
    pub(crate) fn new(
        command: Command,
        process_name: &'static str,
        session_prefix: &'static str,
    ) -> Self {
        Self {
            command,
            process_name,
            session_prefix,
            stdin_input: None,
        }
    }

    pub(crate) fn with_stdin(mut self, stdin_input: String) -> Self {
        self.stdin_input = Some(stdin_input);
        self
    }
}

pub(crate) fn run_ai_agent_line_stream<F>(
    process: LineStreamProcess,
    mut emit: F,
    format_error: impl Fn(&str, &str) -> String,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let run = run_line_stream_process(process, &mut emit)?;

    if !run.status.success() {
        emit(AiAgentStreamEvent::Error {
            message: format_error(&run.stderr_output, &run.status.to_string()),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(run.session_id)
}

fn run_line_stream_process<F>(
    mut process: LineStreamProcess,
    emit: &mut F,
) -> Result<LineStreamRun, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    if process.stdin_input.is_some() {
        process.command.stdin(std::process::Stdio::piped());
    }

    let mut child = process
        .command
        .spawn()
        .map_err(|error| super::format_spawn_error(process.process_name, &error))?;
    let stdin_writer =
        write_stdin_input_async(&mut child, process.process_name, process.stdin_input.take());
    let stdout = child.stdout.take().ok_or("No stdout handle")?;
    let stderr_reader = read_stderr_async(child.stderr.take());
    let child = crate::ai_agent_processes::register_current_stream_child(child);
    let session_id = agent_session_id(process.session_prefix);

    emit(AiAgentStreamEvent::Init {
        session_id: session_id.clone(),
    });
    stream_text_stdout(stdout, emit);

    let mut stderr_output = stderr_reader.join().unwrap_or_default();
    if let Some(error) = stdin_write_error(stdin_writer) {
        append_diagnostic_line(&mut stderr_output, &error);
    }
    let status = child.wait()?;

    Ok(LineStreamRun {
        session_id,
        stderr_output,
        status,
    })
}

fn agent_session_id(prefix: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{prefix}-{}-{ts}", std::process::id())
}

fn stream_text_stdout<F>(stdout: ChildStdout, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let reader = std::io::BufReader::new(stdout);
    for line in reader.lines() {
        match line {
            Ok(line) => emit(AiAgentStreamEvent::TextDelta {
                text: format!("{}\n", strip_ansi_codes(&line)),
            }),
            Err(error) => {
                emit(AiAgentStreamEvent::Error {
                    message: format!("Read error: {error}"),
                });
                break;
            }
        }
    }
}

fn write_stdin_input_async(
    child: &mut std::process::Child,
    process_name: &'static str,
    stdin_input: Option<String>,
) -> Option<std::thread::JoinHandle<Result<(), String>>> {
    let input = stdin_input?;
    let Some(stdin) = child.stdin.take() else {
        return Some(std::thread::spawn(move || {
            Err(format!(
                "Failed to write {process_name} stdin: no stdin handle"
            ))
        }));
    };

    Some(std::thread::spawn(move || {
        write_all_to_stdin(stdin, process_name, input)
    }))
}

fn write_all_to_stdin(
    mut stdin: ChildStdin,
    process_name: &str,
    input: String,
) -> Result<(), String> {
    stdin
        .write_all(input.as_bytes())
        .map_err(|error| format!("Failed to write {process_name} stdin: {error}"))
}

fn stdin_write_error(
    handle: Option<std::thread::JoinHandle<Result<(), String>>>,
) -> Option<String> {
    match handle?.join() {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some("Failed to write AI agent stdin: writer thread panicked".into()),
    }
}

fn read_stderr_async(stderr: Option<ChildStderr>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let Some(mut stderr) = stderr else {
            return String::new();
        };

        let mut output = String::new();
        let _ = stderr.read_to_string(&mut output);
        output
    })
}

fn append_diagnostic_line(output: &mut String, line: &str) {
    if !output.is_empty() {
        output.push('\n');
    }
    output.push_str(line);
}

pub(crate) fn strip_ansi_codes(input: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
    re.replace_all(input, "").to_string()
}
