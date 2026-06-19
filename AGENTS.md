# AGENTS.md

## Cursor Cloud specific instructions

This repository is a single **.NET 8 C# console application** (a coursework lab). There are no services, web servers, databases, or external dependencies, and no automated test projects.

- The project lives under a directory with a space in its name: `lab3 zad/lab3 zad/lab3 zad.csproj`. Always **quote** the path in `dotnet` commands.
- The `.NET 8 SDK` is provided by the VM environment (installed via `dotnet-sdk-8.0`); the startup update script only runs `dotnet restore`.
- Common commands (run from the repo root):
  - Build: `dotnet build "lab3 zad/lab3 zad/lab3 zad.csproj"`
  - Run: `dotnet run --project "lab3 zad/lab3 zad/lab3 zad.csproj"`
  - Lint/format check: `dotnet format "lab3 zad/lab3 zad/lab3 zad.csproj" --verify-no-changes`
- Running the app exercises its full functionality: it prints reader/book info and randomized review ratings (output is in Polish) and then exits. There is nothing long-running to keep alive.
