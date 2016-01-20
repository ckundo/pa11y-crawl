#! /usr/bin/env node

var Crawler = require('simplecrawler');
var pa11y = require('pa11y');
var chalk = require('chalk');
var jsonfile = require('jsonfile');
var async = require('async');
var singlelog = require('single-line-log').stdout;
var argv = require('minimist')(process.argv.slice(2), {
  alias: {
    's': 'standard',
    'u': 'url',
    't': 'timeout',
    'h': 'help',
    'o': 'output',
    'v': 'version',
    'r': 'reporter',
    'p': 'parallel',
    'q': 'quiet',
    'x': 'exclude'
  },
  default: {
    'standard': 'WCAG2AA',
    'timeout': 60000,
  }
});

var usage = require('./usage');

// TODO: command line options
// "reporter"; json or ci
// verbose
// save site?

if (argv.help || (argv._.length === 0)) {
  usage();
  process.exit();
}

if (argv.version) {
  console.log(require('./package').version);
  process.exit();
}

var url = argv.url || argv._[0];
var standard = argv.standard;
var timeout = argv.timeout;
var parallel = argv.parallel;
var output = argv.output;
var quiet = argv.quiet;

var pa11yTest = pa11y({
  standard: standard
  , timeout: timeout
  // , ignore: ['warning','notice']
  // , log: {
  //     debug: console.log.bind(console),
  //     error: console.error.bind(console),
  //     info: console.info.bind(console)
  // }
  // , page: {
  //     loadImages: false
  // }
});

var myCrawler = Crawler.crawl(url);
myCrawler.stripQuerystring = true;

// myCrawler.cache = new Crawler.cache('./tmp/');
// console.log(myCrawler.cache);
//

if (argv.exclude) {
  // myCrawler.removeFetchCondition(conditionID);
  var conditionID = myCrawler.addFetchCondition(function(parsedURL) {
    // speed up crawl by ignoring non-html files (but make sure to include folders)
    // TODO: this regex will probably fail for some urls, causing the final report to show up oddly
    // TODO: determine whether this will impact css or js rules
    return !parsedURL.path.match(/(\.js|\.jpg|\.css|\.png|\.gif)$/i);
  });
}

myCrawler.on('crawlstart', function () {
  if (!quiet) {
    console.log(chalk.cyan('|| ------------------------------------------------------'));
    console.log(chalk.cyan('||')+' Target: '+url);
    console.log(chalk.cyan('||')+' Standard: '+standard);
    if (argv.exclude) {
      console.log(chalk.cyan('||')+' Exclude assets '+chalk.green('on'));
    }
    if (parallel) {
      console.log(chalk.cyan('||')+' Parallel processing '+chalk.green('on'));
    }
    console.log(chalk.cyan('|| ------------------------------------------------------'));
    console.log(chalk.cyan('||')+' Starting crawl...');
  }
});

var overallError = 0;
var overallWarning = 0;
var overallNotice = 0;
var totalPages = 0;
var pagesChecked = 0;
var pages = [];
var results = {
  overall: {},
  pages: {}
};

var scan = function (url, callback) {
  pa11yTest.run(url, function (err, res) {
    // res is an array of objects, one object for each a11y error, warning, or notice

    if (!quiet) {
      console.log(chalk.cyan('|| ------------------------------------------------------'));
    }
    if (err) {
      console.log(err);
    } else {
      pagesChecked += 1;
      var error = 0;
      var warning = 0;
      var notice = 0;
      if (!quiet) {
        console.log(chalk.cyan('||') + ' pa11y result for ' + url);
      }
      for (var r in res) {
        switch (res[r].type) {
          case 'error':
          error += 1;
          overallError += 1;
          break;
          case 'warning':
          warning += 1;
          overallWarning += 1;
          break;
          case 'notice':
          notice += 1;
          overallNotice += 1;
          break;
        }
      }
      results.pages[url] = res;
      if (!quiet) {
        console.log(chalk.cyan('||')+' Errors: '+chalk.red(error)+' | Warning: '+chalk.yellow(warning)+' | Notice: '+chalk.green(notice));
      }
      callback();
    }

    if (pages.length == pagesChecked) {
      results.overall.error = overallError;
      results.overall.warning = overallWarning;
      results.overall.notice = overallNotice;
      if (!quiet) {
        console.log(chalk.cyan('|| ------------------------------------------------------'));
        console.log(chalk.cyan('||')+' Scan complete:');
        console.log(chalk.cyan('||')+' Pages checked: '+pagesChecked);
        console.log(chalk.cyan('||')+' Errors: '+chalk.red(overallError)+' | Warning: '+chalk.yellow(overallWarning)+' | Notice: '+chalk.green(overallNotice));
        console.log(chalk.cyan('|| ------------------------------------------------------'));
      }
      if (output) {
        jsonfile.writeFile(output, results, function (err) {
          if (err) {
            console.log(error);
          }
        });
      }
    }
  });
};

myCrawler.on("fetchcomplete", function (queueItem, responseBuffer, response) {
  totalPages += 1;
  // console.log(responseBuffer.toString());
  // Check that resource is HTML and that it's not a meta refresh
  if (response.headers['content-type'].match(/html/) && (!responseBuffer.toString().match(/http-equiv=("|')refresh("|')/))) {
    pages.push(queueItem.url);
    // TODO: mirror site locally and test there instead
    // TODO: ci mode that exits with 1 on any error (possibly with list of errors)
  }
  if (!quiet) {
    singlelog(chalk.cyan('||')+' Found '+pages.length+' pages to scan out of '+totalPages+'\n');
  }
});

myCrawler.on("complete", function () {
  if (!quiet) {
    console.log(chalk.cyan('||')+' Crawl complete!');
    console.log(chalk.cyan('|| ------------------------------------------------------'));
    console.log(chalk.cyan('||')+' Starting pa11y scans...');
  }
  if (!parallel) {
    async.eachSeries(pages, function (page, callback) {
      scan(page, callback);
    });
  } else {
    for (var p in pages) {
      scan(pages[p]);
    }
  }
});