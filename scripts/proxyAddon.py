import hashlib
import inspect
import os
import logging
import sys

from mitmproxy.script import concurrent

import sj
import traceback

import mitmproxy.http


class JalangiAddon:
    # Used to initialize and mimic the behaviour of the broken proxy script file.
    def __init__(self, jalangi_analysis=None, jalangi_args=None, cache=True, ignored=None):
        if ignored is None:
            ignored = []
        # instead of doing nothing, fill the args with the mostly sensible example params
        if jalangi_args is None:
            jalangi_args = "--inlineIID --inlineSource"
        # Likewise, we want some proper analysis scripts to run even without any specified ones
        if jalangi_analysis is None:
            jalangi_analysis = ["src/js/sample_analyses/ChainedAnalyses.js",
                                "src/js/sample_analyses/trace/EventActionTraceLogger.js"]
        self.useCache = cache
        self.ignoredUrls = ignored

        filename = inspect.getframeinfo(inspect.currentframe()).filename
        self.jalangiHome = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(filename)), os.pardir))

        full_jalangi_analysis_paths = list(map(self.add_jalangi_path, jalangi_analysis))

        for i in range(0, len(jalangi_analysis)):
            full_jalangi_analysis_paths.insert(i * 2, "--analysis")

        self.jalangiAnalysisParams = " ".join(full_jalangi_analysis_paths)
        self.jalangiArgs = jalangi_args

        print("Initializing mitmproxy Jalangi addon.")
        print("Jalangi home (expected analysis file location):", self.jalangiHome)
        print("CWD (and cache location):", os.getcwd())
        print("Active analysis files for Jalangi:", jalangi_analysis)
        print("DEBUG:", self.jalangiAnalysisParams)

    def add_jalangi_path(self, el):
        return os.path.join(self.jalangiHome, el)

    def process_file(self, flow, content, ext):
        try:
            url = flow.request.scheme + '://' + flow.request.host + ':' + str(flow.request.port) + flow.request.path
            name = os.path.splitext(flow.request.path_components[-1])[0] if hasattr(flow.request,
                                                                                    'path_components') and len(
                flow.request.path_components) else 'index'
            hashed_content = hashlib.md5(content.encode('utf-8')).hexdigest()

            file_name = os.getcwd() + '/cache/' + flow.request.host + '/' + hashed_content + '/' + name + '.' + ext
            instrumented_file_name = os.getcwd() + '/cache/' + flow.request.host + '/' + hashed_content + '/' + name + '_jalangi_.' + ext
            if not os.path.exists('cache/' + flow.request.host + '/' + hashed_content):
                os.makedirs('cache/' + flow.request.host + '/' + hashed_content)
            if not self.useCache or not os.path.isfile(instrumented_file_name):
                print('Instrumenting: ' + file_name + ' from ' + url)
                with open(file_name, 'w') as file:
                    file.write(content)
                sub_env = {'JALANGI_URL': url}
                sj.execute(
                    sj.INSTRUMENTATION_SCRIPT + ' ' + self.jalangiArgs + ' ' + self.jalangiAnalysisParams + ' ' +
                    file_name + ' --out ' + instrumented_file_name + ' --outDir '
                    + os.path.dirname(instrumented_file_name), None, sub_env)
            else:
                print('Already instrumented: ' + file_name + ' from ' + url)
            with open(instrumented_file_name, 'r') as file:
                data = file.read()
            return data
        # fixme: find all possible error types
        except ValueError:
            print('Exception in processFile() @ proxy.py')
            exc_type, exc_value, exc_traceback = sys.exc_info()
            lines = traceback.format_exception(exc_type, exc_value, exc_traceback)
            print(''.join(lines))
            return content

    # Called when the full HTTP response has been read.
    def response(self, flow: mitmproxy.http.HTTPFlow):
        # skip ignored URLs
        for path in self.ignoredUrls:
            if flow.request.url.startswith(path):
                return
        # Do not invoke jalangi if the requested URL contains the query parameter noInstr
        # (e.g. https://cdn.com/jalangi/jalangi.min.js?noInstr=true)
        if flow.request.query and flow.request.query.get("noInstr", None):
            return

        # begin jalangi instrumentation
        try:
            flow.response.decode()
            content_type = None
            csp_key = None
            for key in flow.response.headers.keys():
                if key.lower() == "content-type":
                    content_type = flow.response.headers[key].lower()
                elif key.lower() == "content-security-policy":
                    csp_key = key
            # by directly editing flow.response, we can perform the instrumentation using jalangi2-s analysis tools.
            if content_type:
                if content_type.find('javascript') >= 0:
                    flow.response.text = self.process_file(flow, flow.response.text, 'js')
                if content_type.find('html') >= 0:
                    flow.response.text = self.process_file(flow, flow.response.text, 'html')
                if content_type.find('mvc') >= 0:
                    flow.response.text = self.process_file(flow, flow.response.text, 'html')
            # Disable the content security policy since it may prevent jalangi from executing
            if csp_key:
                flow.response.headers.pop(csp_key, None)

        # fixme: find all exception types that can be caught here
        except ValueError:
            logging.error("Exception in response() @ proxy.py")
            exc_type, exc_value, exc_traceback = sys.exc_info()
            lines = traceback.format_exception(exc_type, exc_value, exc_traceback)
            print(''.join(lines))


addons = [JalangiAddon(cache=True)]
