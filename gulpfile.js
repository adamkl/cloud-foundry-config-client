const gulp = require("gulp");
const del = require("del");
const merge = require("merge2");
const runSequence = require("run-sequence");
const tsProject = require("gulp-typescript").createProject("tsconfig.json");

gulp.task("rebuild", function() {
  return runSequence("scrub", "build");
});

gulp.task("scrub", function() {
  return del("lib/**", { force: true });
});

gulp.task("build", function() {
  const tsResult = tsProject.src().pipe(tsProject());
  return merge([
    tsResult.dts.pipe(gulp.dest("lib/types")),
    tsResult.js.pipe(gulp.dest("lib/js"))
  ]);
});
