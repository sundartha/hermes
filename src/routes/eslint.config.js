import basis from "../../eslint.config.js";

export default [
  ...basis,
  {
    rules: {
      "max-params": "off",
      "max-depth": "off",
      "no-param-reassign": "off",
    },
  },
];
