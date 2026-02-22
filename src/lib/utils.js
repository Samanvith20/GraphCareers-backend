const normalizeSkills = (skills) =>
  Array.from(
    new Set(
      skills
        .map((s) =>
          s
            .toLowerCase()
            .replace(/\./g, "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean)
    )
  );