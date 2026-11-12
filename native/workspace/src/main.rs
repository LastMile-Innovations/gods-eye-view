use neighbor_workspace::Workspace;
use serde_json::json;
use std::io::{self, BufRead, Read, Write};
fn main() {
    let Some(directory) = std::env::args_os().nth(1) else {
        std::process::exit(2)
    };
    let store = match Workspace::open(std::path::Path::new(&directory)) {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Native workspace initialization failed");
            std::process::exit(1)
        }
    };
    let mut input = io::BufReader::new(io::stdin());
    let mut output = io::BufWriter::new(io::stdout());
    loop {
        let mut line = vec![];
        let read = std::io::Read::by_ref(&mut input)
            .take(8 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut line);
        let Ok(size) = read else { break };
        if size == 0 {
            break;
        }
        let result = if size > 8 * 1024 * 1024 {
            Err("RESOURCE_LIMIT".into())
        } else {
            serde_json::from_slice(&line)
                .map_err(|_| "INVALID".into())
                .and_then(|v| store.execute(v))
        };
        let value = match result {
            Ok(v) => v,
            Err(code) => json!({"error":{"code":code}}),
        };
        if writeln!(output, "{value}")
            .and_then(|_| output.flush())
            .is_err()
        {
            break;
        }
        if size > 8 * 1024 * 1024 {
            break;
        }
    }
}
