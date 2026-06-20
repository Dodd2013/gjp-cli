import readline from "node:readline";
import { stdin, stdout } from "node:process";

/** 隐藏输入的密码读取（raw 模式关闭回显） */
export function readPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    stdout.write(question);
    const wasRaw = stdin.isTTY;
    if (wasRaw) stdin.setRawMode(true);
    let value = "";
    const onData = (c: Buffer) => {
      const s = c.toString();
      // Enter / Ctrl-C / Ctrl-D
      if (s === "\r" || s === "\n" || s === "") {
        stdin.off("data", onData);
        if (wasRaw) stdin.setRawMode(false);
        rl.close();
        stdout.write("\n");
        resolve(value.trim());
      } else if (s === "") {
        process.exit(0);
      } else if (s === "" || s === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
      } else {
        value += s;
        stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}
