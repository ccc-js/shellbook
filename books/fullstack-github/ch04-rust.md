# 第四章：Rust 骨架＋測試

同一個專案裡放第二個語言：`cargo init` 開 `rust-app/` 子目錄、
`cargo test` 變綠。感受一下兩種生態的測試輸出有何不同。

## 範例 1：建 rust 骨架＋跑測試

```sh #run expect:ok
R="$SHELLBOOK_WS/demo-proj"
rm -rf "$R/rust-app"
cargo init --bin --name rust-app "$R/rust-app"
cd "$R/rust-app" && cargo test --offline
```

## 範例 2：加一個會過的測試

```bash #run expect:1 passed
R="$SHELLBOOK_WS/demo-proj/rust-app"
cat > "$R/src/main.rs" <<EOF
fn greet() -> &'static str { "hello-rust" }
fn main() { println!("{}", greet()); }
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greet_works() { assert_eq!(greet(), "hello-rust"); }
}
EOF
cd "$R" && cargo test --offline
cargo run --offline -q --manifest-path "$R/Cargo.toml"
```

## 範例 3：忽略 target＋commit

```bash #run expect:rust
R="$SHELLBOOK_WS/demo-proj"
printf 'target/\n' >> "$R/rust-app/.gitignore"
git -C "$R" add rust-app
git -C "$R" commit -m "feat(rust): rust-app with test"
git -C "$R" status --short
```
