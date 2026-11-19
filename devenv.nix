{...}: {
  languages = {
    go.enable = true;
    javascript = {
      enable = true;
      pnpm.enable = true;
    };
  };

  # .env is managed by SecretSpec's dotenv provider, not devenv's dotenv
  # integration, so silence the "found .env but not enabled" hint.
  dotenv.disableHint = true;

  # `devenv up` starts the Go server (:8080) and Vite HMR (:5173) together.
  # Open http://localhost:5173; dev variables live in secretspec.toml and .env.
  processes.backend.exec = "exec secretspec run --provider dotenv -- go run ./cmd/reader";
  processes.frontend.exec = "exec pnpm --dir web dev";

  # Static checks and tests. `test` is avoided because the shell builtin would
  # shadow the script in PATH.
  scripts.check.exec = "go vet ./... && go tool golangci-lint run ./... && pnpm --dir web check";
  scripts.tests.exec = "go test -race ./... && pnpm --dir web test";
}
