use gfa_gen::{Options, generate};
use std::io::{self, BufWriter, Write};
use std::process::ExitCode;

const USAGE: &str = "usage: gfa-gen [--segments N] [--seed N] [--mean-length N] [--overlap N]
               [--components N] [--bubbles F] [--tips F] [--repeats F]
               [--no-sequence] [--out PATH]";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("gfa-gen: {message}\n{USAGE}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut options = Options::default();
    let mut out_path = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let mut value = || args.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--segments" => options.segments = parse(&value()?)?,
            "--seed" => options.seed = parse(&value()?)?,
            "--mean-length" => options.mean_length = parse(&value()?)?,
            "--overlap" => options.overlap = parse(&value()?)?,
            "--components" => options.components = parse(&value()?)?,
            "--bubbles" => options.bubbles = parse(&value()?)?,
            "--tips" => options.tips = parse(&value()?)?,
            "--repeats" => options.repeats = parse(&value()?)?,
            "--no-sequence" => options.sequences = false,
            "--out" => out_path = Some(value()?),
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(());
            }
            other => return Err(format!("unknown argument {other}")),
        }
    }
    let result = match out_path {
        Some(path) => {
            let file = std::fs::File::create(&path).map_err(|e| format!("{path}: {e}"))?;
            write(&options, BufWriter::new(file))
        }
        None => write(&options, BufWriter::new(io::stdout().lock())),
    };
    result.map_err(|e| e.to_string())
}

fn write(options: &Options, mut out: impl Write) -> io::Result<()> {
    generate(options, &mut out)?;
    out.flush()
}

fn parse<T: std::str::FromStr>(text: &str) -> Result<T, String> {
    text.parse()
        .map_err(|_| format!("not a valid number: {text}"))
}
