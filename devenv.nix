{...}: {
  languages = {
    go.enable = true;
    javascript = {
      enable = true;
      pnpm = {
        enable = true;
        install.enable = true;
      };
    };
  };
}