# Rust or Go for a side project

## You

I keep going back and forth — Rust or Go for a small API side project?

## AI

For a small API with a shipping deadline, Go: you'll finish. The standard library covers HTTP, deploys are a single binary, and the borrow checker never interrupts you at 11pm.

## You

When would Rust be the right call?

## AI

When correctness under concurrency is the product — a parser, a proxy, anything where a data race is a security bug. If the fun *is* the engineering, Rust pays you back. If the fun is the finished thing, Go.
