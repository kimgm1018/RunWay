// 실행: groovy infra/jenkins/tests/RouteCiTest.groovy
// 실제 Pipeline을 실행하되 Jenkins·Shell 작업은 기록해 분기·실패 전파를 검증한다.
loader = new GroovyClassLoader(this.class.classLoader)
loader.parseClass('package org.jenkinsci.plugins.workflow.steps\nclass FlowInterruptedException extends RuntimeException {}')

def runCi(Map opts) {
    def r = [stages: [], commands: [], statuses: [], reports: [], error: null]
    def context = new Binding([
        env: [gitlabMergeRequestIid: opts.manual ? null : '507', gitlabTargetBranch: opts.target ?: 'dev',
              gitlabMergeRequestLastCommit: 'source', gitlabMergeRequestTitle: 'Route CI',
              BUILD_NUMBER: '1', BUILD_TAG: 'jenkins-runway-ci-1'],
        currentBuild: [currentResult: 'SUCCESS'], none: 'none',
        pipeline: { Closure body -> body() }, agent: { ignored -> }, options: { Closure ignored -> },
        stages: { Closure body -> body() }, stage: { String name, Closure body -> r.stages << name; body() },
        steps: { Closure body -> body() }, script: { Closure body -> body() },
        node: { String label, Closure body -> body() }, dir: { String path, Closure body -> body() },
        deleteDir: { -> }, checkout: { Map ignored -> }, echo: { ignored -> },
        withEnv: { List values, Closure body -> body() },
        withCredentials: { List values, Closure body -> body() }, string: { Map value -> value },
        sh: { args ->
            def command = args instanceof Map ? args.script : args.toString()
            r.commands << command
            if (opts.failOn && command.contains(opts.failOn)) throw new RuntimeException('검사 실패')
            if (args instanceof Map && args.returnStdout) {
                if (command.contains('git diff')) return opts.files.join('\u0000')
                return command.contains('rev-parse HEAD') ? 'source\n' : 'target\n'
            }
            return 0
        },
        junit: { Map args ->
            r.reports << args.testResults
            return [failCount: opts.failedReport && args.testResults == 'artifacts/route/pytest.xml' ? 1 : 0]
        },
        archiveArtifacts: { Map args -> r.commands << "archive:${args.artifacts}".toString() },
        error: { message -> throw new RuntimeException(message.toString()) },
        updateGitlabCommitStatus: { Map args -> r.statuses << "${args.name}:${args.state}".toString() },
        gitlabCommitStatus: { Map args, Closure body ->
            r.statuses << "${args.name}:running".toString()
            try { body(); r.statuses << "${args.name}:success".toString() }
            catch (Throwable e) { r.statuses << "${args.name}:failed".toString(); throw e }
        },
        parallel: { Map branches -> branches.values().each { it() } },
    ])
    try { new GroovyShell(loader, context).parse(new File('infra/jenkins/Jenkinsfile.ci')).run() }
    catch (Throwable e) { r.error = e }
    return r
}

def command(String stage) { "sh infra/jenkins/check-route.sh --stage ${stage}".toString() }

['ai/route_service/app/main.py', 'infra/route/compose.yaml'].each { path ->
    ['dev', 'master'].each { target ->
        def r = runCi(files: [path], target: target)
        assert r.error == null: r.error
        assert r.stages.containsAll(['Route Checkout', 'Route Test Image', 'Route Tests', 'Route Reports'])
        assert !r.stages.contains('AI Tests')
        assert r.statuses.containsAll(['route-ci:running', 'route-ci:success', 'ai-ci:skipped'])
        assert r.reports == ['artifacts/route/pytest.xml']
        assert r.commands.contains(command('clean'))
    }
}

def skipped = runCi(files: ['docs/README.md'])
assert skipped.error == null && skipped.statuses.contains('route-ci:skipped')
assert !skipped.stages.contains('Route Checkout')

['test-image', 'test'].each { stage ->
    def failed = runCi(files: ['ai/route_service/app/main.py'], failOn: "check-route.sh --stage ${stage}")
    assert failed.error != null && failed.statuses.contains('route-ci:failed')
    assert failed.statuses.contains('runway-ci:failed')
    assert failed.commands.contains(command('clean'))
    assert failed.stages.contains('Route Reports')
}

def report = runCi(files: ['infra/route/compose.yaml'], failedReport: true)
assert report.error != null && report.statuses.contains('route-ci:failed')
assert report.commands.contains(command('clean'))

def preparation = runCi(files: ['ai/route_service/app/main.py'], target: 'unsupported')
assert preparation.error != null && preparation.statuses.contains('route-ci:skipped')
assert !preparation.stages.contains('Route Checkout')

def common = runCi(files: ['infra/jenkins/Jenkinsfile.ci'])
assert common.error == null: common.error
assert common.stages.containsAll(['AI Tests', 'Route Tests', 'Backend Checks and Tests', 'Mobile Tests', 'Watch Tests'])

def manual = runCi(files: [], manual: true)
assert manual.error == null: manual.error
assert manual.stages.containsAll(['AI Tests', 'Route Tests'])
println 'Route CI: 11 scenarios passed'
