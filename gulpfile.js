const raster = require('gulp-raster');
const rename = require('gulp-rename');
const gulp = require('gulp');
gulp.task('default', () => {
     return gulp.src('./logo/*.svg')
    .pipe(raster())
    .pipe(rename({extname: '.png'}))
    .pipe(gulp.dest('./images'));
});