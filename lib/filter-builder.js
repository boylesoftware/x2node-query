'use strict';

const common = require('x2node-common');

const ValueExpression = require('./value-expression.js');
const placeholders = require('./placeholders.js');
const queryTreeBuilder = require('./query-tree-builder.js');
const Translatable = require('./translatable.js');


/**
 * Filter base class.
 *
 * @protected
 * @memberof module:x2node-dbos
 * @inner
 * @extends module:x2node-dbos~Translatable
 * @abstract
 */
class RecordsFilter extends Translatable {

	/**
	 * Create new filter base.
	 */
	constructor() {
		super();
	}

	/**
	 * Tell if this specification is empty (effectively a noop).
	 *
	 * @returns {boolean} <code>true</code> if empty.
	 */
	isEmpty() { return false; }

	/**
	 * Tell if this specification included in a logical junction needs to be
	 * supprouned in parenthesis.
	 *
	 * @param {string} juncType Type of the junction, in which the element is
	 * being included.
	 * @returns {boolean} <code>true</code> if needs to be surrounded in
	 * parenthesis.
	 */
	needsParen() { return false; }

	/**
	 * Tell if has collection tests.
	 *
	 * @function module:x2node-dbos~RecordsFilter#hasCollectionTests
	 * @returns {boolean} <code>true</code> if has collection tests.
	 */

	/**
	 * Form logical conjunction with another filter. Neither this nor the other
	 * filter are modified.
	 *
	 * @param {module:x2node-dbos~RecordsFilter} otherFilter The other filter.
	 * @returns {module:x2node-dbos~RecordsFilter} Resulting conjunction.
	 */
	conjoin(otherFilter) {

		return (new RecordsFilterJunction('AND', false))
			.addElement(this)
			.addElement(otherFilter);
	}
}

/**
 * Filter logical junction.
 *
 * @private
 * @memberof module:x2node-dbos
 * @inner
 * @extends module:x2node-dbos~RecordsFilter
 */
class RecordsFilterJunction extends RecordsFilter {

	/**
	 * Create new junction.
	 *
	 * @param {string} juncType Either "AND" or "OR".
	 * @param {boolean} invert <code>true</code> to negate the whole junction.
	 */
	constructor(juncType, invert) {
		super();

		this._juncType = juncType;
		this._invert = invert;
	}

	/**
	 * Add element to the junction.
	 *
	 * @param {module:x2node-dbos~RecordsFilter} element Element to add to the
	 * junction. If the element is empty, it's ignored.
	 * @returns {module:x2node-dbos~RecordsFilterJunction} This junction.
	 */
	addElement(element) {

		if (!element.isEmpty()) {

			if (!this._elements)
				this._elements = new Array();
			this._elements.push(element);

			element.usedPropertyPaths.forEach(p => {
				this._usedPropertyPaths.add(p);
			});
		}

		return this;
	}

	// empty test implementation
	isEmpty() {

		return (!this._elements || (this._elements.length === 0));
	}

	// needs parenthesis implementation
	needsParen(juncType) {

		if (this.isEmpty()) // should never happend anyway
			return false;

		if (this._invert)
			return false;

		if (this._elements.length === 1)
			return this._elements[0].needsParen(juncType);

		return (this._juncType !== juncType);
	}

	// having collection tests implementation
	hasCollectionTests() {

		if (this.isEmpty()) // should never happend anyway
			return false;

		for (let e of this._elements)
			if (e.hasCollectionTests())
				return true;

		return false;
	}

	// translation implementation
	translate(ctx) {

		if (this.isEmpty())
			throw new Error(
				'Internal X2 error: translating empty logical junction.');

		let juncSql;
		if (this._elements.length === 1) {
			juncSql = this._elements[0].translate(ctx);
		} else {
			juncSql = this._elements.map(element => {
				const elementSql = element.translate(ctx);
				return (
					element.needsParen(this._juncType) ?
						'(' + elementSql + ')' : elementSql
				);
			}).join(' ' + this._juncType + ' ');
		}

		return (this._invert ? 'NOT (' + juncSql + ')' : juncSql);
	}
}

/**
 * Filter single value expression test.
 *
 * @private
 * @memberof module:x2node-dbos
 * @inner
 * @extends module:x2node-dbos~RecordsFilter
 */
class RecordsFilterValueTest extends RecordsFilter {

	/**
	 * Create new test.
	 *
	 * @param {module:x2node-dbos~ValueExpression} valueExpr Value expression
	 * to test.
	 * @param {string} testType Test type.
	 * @param {boolean} invert <code>true</code> to negate the test.
	 * @param {Array} [testParams] Test type specific number of test parameters.
	 * Each parameter can be a value expression, a filter parameter or a value.
	 */
	constructor(valueExpr, testType, invert, testParams) {
		super();

		this._valueExpr = valueExpr;
		this._testType = testType;
		this._invert = invert;
		this._testParams = testParams;

		valueExpr.usedPropertyPaths.forEach(p => {
			this._usedPropertyPaths.add(p);
		});
		if (testParams) {
			for (let i = 0, len = testParams.length; i < len; i++) {
				const testParam = testParams[i];
				if (testParam instanceof ValueExpression)
					testParam.usedPropertyPaths.forEach(p => {
						this._usedPropertyPaths.add(p);
					});
			}
		}
	}

	// report as not a collection test
	hasCollectionTests() { return false; }

	// translation implementation
	translate(ctx) {

		const valSql = this._valueExpr.translate(ctx);

		function testParamSql(param, litValueFunc, exprValueFunc) {

			if (param instanceof ValueExpression) {
				const exprSql = param.translate(ctx);
				return (exprValueFunc ? exprValueFunc(exprSql) : exprSql);
			}

			if (placeholders.isParam(param))
				return ctx.paramsHandler.addParam(param.name, litValueFunc);

			return ctx.paramsHandler.paramValueToSql(
				ctx.dbDriver, param, litValueFunc);
		}

		switch (this._testType) {
		case 'eq':
			return valSql + ' = ' + testParamSql(this._testParams[0]);
		case 'ne':
			return valSql + ' <> ' + testParamSql(this._testParams[0]);
		case 'ge':
			return valSql + ' >= ' + testParamSql(this._testParams[0]);
		case 'le':
			return valSql + ' <= ' + testParamSql(this._testParams[0]);
		case 'gt':
			return valSql + ' > ' + testParamSql(this._testParams[0]);
		case 'lt':
			return valSql + ' < ' + testParamSql(this._testParams[0]);
		case 'in':
			return valSql + (this._invert ? ' NOT' : '') +
				' IN (' + this._testParams.map(p => testParamSql(p)).join(', ') +
				')';
		case 'between':
			return valSql + (this._invert ? ' NOT' : '') +
				' BETWEEN ' + testParamSql(this._testParams[0]) +
				' AND ' + testParamSql(this._testParams[1]);
		case 'contains':
		case 'containsi':
			return ctx.dbDriver.patternMatch(
				valSql, testParamSql(
					this._testParams[0],
					lit =>
						'%' + ctx.dbDriver.safeLikePatternFromString(lit) + '%',
					expr =>
						ctx.dbDriver.nullableConcat(
							ctx.dbDriver.stringLiteral('%'),
							ctx.dbDriver.safeLikePatternFromExpr(expr),
							ctx.dbDriver.stringLiteral('%')
						)
				),
				this._invert, !this._testType.endsWith('i'));
		case 'starts':
		case 'startsi':
			return ctx.dbDriver.patternMatch(
				valSql, testParamSql(
					this._testParams[0],
					lit =>
						ctx.dbDriver.safeLikePatternFromString(lit) + '%',
					expr =>
						ctx.dbDriver.nullableConcat(
							ctx.dbDriver.safeLikePatternFromExpr(expr),
							ctx.dbDriver.stringLiteral('%')
						)
				),
				this._invert, !this._testType.endsWith('i'));
		case 'matches':
		case 'matchesi':
			return ctx.dbDriver.regexpMatch(
				valSql, testParamSql(this._testParams[0]),
				this._invert, !this._testType.endsWith('i'));
		case 'empty':
			return valSql + ' IS' + (this._invert ? ' NOT' : '') + ' NULL';
		}
	}
}

/**
 * Filter collection property test.
 *
 * @private
 * @memberof module:x2node-dbos
 * @inner
 * @extends module:x2node-dbos~RecordsFilter
 */
class RecordsFilterCollectionTest extends RecordsFilter {

	/**
	 * Create new test.
	 *
	 * @param {module:x2node-records~RecordTypesLibrary} recordTypes Record types
	 * library.
	 * @param {string} colBasePropPath Path of the property at the collection
	 * reference base.
	 * @param {string} testType Test type, which is either "empty" or "count".
	 * @param {boolean} invert <code>true</code> to negate the test.
	 * @param {Array} testParams Test type specific number of test parameters.
	 * @param {module:x2node-dbos~ValueExpressionContext} valueExprCtx Value
	 * expression context for expressions in the collection filter.
	 * @param {Array[]} [filterSpec] Raw collection filter specification, if any.
	 */
	constructor(
		recordTypes, colBasePropPath,
		testType, invert, testParams,
		valueExprCtx, filterSpec) {
		super();

		// save basics needed for the translation
		this._colPath = valueExprCtx.basePath;
		this._colBasePath = colBasePropPath;
		this._testType = testType;
		this._invert = invert;
		this._testParams = testParams;

		// process collection filter
		if (filterSpec) {

			// build the collection filter
			this._colFilter = buildFilter(
				recordTypes, valueExprCtx, [ ':and', filterSpec ]);

			// find all properties used outside the collection context
			const colBasePathPrefix = this._colBasePath + '.';
			this._colFilter.usedPropertyPaths.forEach(propPath => {
				if (!propPath.startsWith(colBasePathPrefix))
					this._usedPropertyPaths.add(propPath);
			});
		}
	}

	// report as collection test
	hasCollectionTests() { return true; }

	// translation implementation
	translate(ctx) {

		// build properties tree for the subquery
		const propsTree = ctx.buildSubqueryPropsTree(
			this._colPath,
			(this._colFilter ? this._colFilter.usedPropertyPaths : []),
			'where'
		);

		// build the subquery tree
		const subqueryTree = queryTreeBuilder.forExistsSubquery(
			ctx, propsTree, this._colBasePath);

		// build subquery
		const subqueryBuilder = new Object();
		const subqueryCtx = subqueryTree.getTopTranslationContext(
			ctx.paramsHandler);
		subqueryTree.walk(subqueryCtx, (propNode, tableDesc, tableChain) => {
			if (tableChain.length === 0)
				return;
			if (tableChain.length === 1) {
				subqueryBuilder.where = tableDesc.basicJoinCondition;
				if (this._colFilter) {
					const filterSql = ctx.rebaseTranslatable(
						this._colFilter).translate(subqueryCtx);
					subqueryBuilder.where += ' AND ' + (
						this._colFilter.needsParen('AND') ?
							'(' + filterSql + ')' : filterSql);
				}
			}
			if (subqueryBuilder.from) {
				subqueryBuilder.from +=
					' INNER JOIN ' + tableDesc.tableName + ' AS ' +
					tableDesc.tableAlias + ' ON ' + tableDesc.joinCondition;
			} else {
				subqueryBuilder.from = tableDesc.tableName + ' AS ' +
					tableDesc.tableAlias;
			}
		});
		const subqueryFrom = 'FROM ' + subqueryBuilder.from +
			' WHERE ' + subqueryBuilder.where;

		// return the test SQL depending on the test type
		switch (this._testType) {
		case 'count':
			return '(SELECT COUNT(*) ' + subqueryFrom + ') ' +
				(this._invert ? '<> ' : '= ') + String(this._testParams[0]);
		case 'empty':
			return (this._invert ? '' : 'NOT ') +
				'EXISTS (SELECT 1 ' + subqueryFrom + ')';
		}
	}
}

/**
 * Parse records filter specification and build the filter.
 *
 * @protected
 * @param {module:x2node-records~RecordTypesLibrary} recordTypes Record types
 * library.
 * @param {module:x2node-dbos~ValueExpressionContext} valueExprCtx Value
 * expression context to use.
 * @param {Array} testSpec Single raw filter test specification.
 * @returns {module:x2node-dbos~RecordsFilter} The filter. May return
 * <code>undefined</code> if the provided specification results in no filter.
 * @throws {module:x2node-common.X2UsageError} If the specification is invalid.
 */
function buildFilter(recordTypes, valueExprCtx, testSpec) {

	// error function
	const error = msg => new common.X2UsageError(
		'Invalid filter specification' + (
			valueExprCtx.basePath.length > 0 ?
				' on ' + valueExprCtx.basePath : '') + ': ' + msg
	);

	// validate test specification array
	if (!Array.isArray(testSpec) || (testSpec.length === 0))
		throw error(
			'filter test specification must be an array and must not be empty.');

	// parse the predicate
	const pred = testSpec[0];
	if ((typeof pred) !== 'string')
		throw error(`invalid type for predicate "${pred}".`);
	const predParts = pred.match(
			/^\s*(?:(?::(!?\w+)\s*)|([^:=\s].*?)\s*(?:=>\s*(!?\w+)\s*)?)$/i);
	if (predParts === null)
		throw error(`predicate "${pred}" has invalid syntax.`);

	// check if junction
	if (predParts[1] !== undefined) {

		// validate junction conditions array
		if (!Array.isArray(testSpec[1]) || (testSpec.length > 2))
			throw error(
				'logical junction must be followed by exactly one' +
					' array of nested tests.');

		// determine type of the logical junction
		let juncType, invert;
		switch (predParts[1].toLowerCase()) {
		case 'or':
		case 'any':
		case '!none':
			juncType = 'OR'; invert = false;
			break;
		case '!or':
		case '!any':
		case 'none':
			juncType = 'OR'; invert = true;
			break;
		case 'and':
		case 'all':
			juncType = 'AND'; invert = false;
			break;
		case '!and':
		case '!all':
			juncType = 'AND'; invert = true;
			break;
		default:
			throw error(`unknown junction type "${predParts[1]}".`);
		}

		// create junction test object
		const junc = new RecordsFilterJunction(juncType, invert);

		// add junction elements
		testSpec[1].forEach(nestedTestSpec => {
			const nestedTest = buildFilter(
				recordTypes, valueExprCtx, nestedTestSpec);
			if (nestedTest)
				junc.addElement(nestedTest);
		});

		// return the result if not empty junction
		return (junc.isEmpty() ? undefined : junc);
	}

	// test, not a junction:

	// parse the value expression
	const valueExpr = new ValueExpression(valueExprCtx, predParts[2]);

	// vars for the test
	let testType, invert = false, testParams;

	// check if collection test
	const singlePropValueExprCtx = (
		valueExpr.isSinglePropRef() &&
			valueExprCtx.getRelativeContext(predParts[2]));
	if (singlePropValueExprCtx &&
		!singlePropValueExprCtx.basePropertyDesc.isScalar()) {

		// parse and validate the test
		let colFilterSpecInd = 1;
		const rawTestType = (
			predParts[3] !== undefined ? predParts[3] : '!empty');
		/* eslint-disable no-fallthrough */
		switch (rawTestType.toLowerCase()) {
		case '!empty':
			invert = true;
		case 'empty':
			testType = 'empty';
			break;
		case '!count':
			invert = true;
		case 'count':
			testType = 'count';
			testParams = [ testSpec[1] ];
			if (!Number.isInteger(testParams[0]))
				throw error(
					`test "${rawTestType}" expects an integer number argument.`);
			colFilterSpecInd = 2;
			break;
		default:
			throw error(
				`invalid collection test "${pred}" as it may only be "empty"` +
					', "!empty", "count" or "!count".');
		}
		/* eslint-enable no-fallthrough */

		// validate test arguments
		const colFilterSpec = testSpec[colFilterSpecInd];
		if ((testSpec.length > colFilterSpecInd + 1) || (
			(colFilterSpec !== undefined) && !Array.isArray(colFilterSpec)))
			throw error(
				'collection test may only have none or a single' +
					' collection filter argument and it must be an array.');

		// create and return collection test
		return new RecordsFilterCollectionTest(
			recordTypes,
			valueExprCtx.normalizePropertyRef(
				predParts[2].match(/^((?:\^\.)*[^.]+)/)[1]),
			testType, invert, testParams,
			singlePropValueExprCtx,
			colFilterSpec
		);
	}

	// single value test:

	// functions for extracting and validating test parameters
	function getSingleTestParam() {
		const v = testSpec[1];
		if ((testSpec.length > 2) || (v === undefined) ||
			(v === null) || Array.isArray(v))
			throw error(
				`test "${rawTestType}" expects a single non-null,` +
					` non-array argument.`);
		return [ v ];
	}
	function getTwoTestParams() {
		let v1, v2;
		switch (testSpec.length) {
		case 2:
			if (Array.isArray(testSpec[1]) && (testSpec[1].length === 2)) {
				v1 = testSpec[1][0];
				v2 = testSpec[1][1];
			}
			break;
		case 3:
			v1 = testSpec[1];
			v2 = testSpec[2];
		}
		if ((v1 === undefined) || (v2 === undefined) ||
			(v1 === null) || (v2 === null) ||
			Array.isArray(v1) || Array.isArray(v2))
			throw error(
				`test "${rawTestType}" expects two non-null,` +
					` non-array arguments.`);
		return [ v1, v2 ];
	}
	function getListTestParams() {
		const f = (a, v) => {
			if ((v === null) || (v === undefined))
				throw error(
					`test "${rawTestType}" expects a list of non-null` +
						` arguments.`);
			if (Array.isArray(v))
				v.forEach(vv => { f(a, vv); });
			else
				a.push(v);
			return a;
		};
		const a = testSpec.slice(1).reduce(f, new Array());
		if (a.length === 0)
			throw error(
				`test "${rawTestType}" expects a list of non-null arguments.`);
		return a;
	}

	// determine the test type
	const rawTestType = (
		predParts[3] ? predParts[3] : (
			testSpec.length > 1 ? 'is' : 'present'));
	/* eslint-disable no-fallthrough */
	switch (rawTestType.toLowerCase()) {
	case 'is':
	case 'eq':
		testType = 'eq';
		testParams = getSingleTestParam();
		break;
	case 'not':
	case 'ne':
	case '!eq':
		testType = 'ne';
		testParams = getSingleTestParam();
		break;
	case 'min':
	case 'ge':
	case '!lt':
		testType = 'ge';
		testParams = getSingleTestParam();
		break;
	case 'max':
	case 'le':
	case '!gt':
		testType = 'le';
		testParams = getSingleTestParam();
		break;
	case 'gt':
		testType = 'gt';
		testParams = getSingleTestParam();
		break;
	case 'lt':
		testType = 'lt';
		testParams = getSingleTestParam();
		break;
	case '!in':
	case '!oneof':
		invert = true;
	case 'in':
	case 'oneof':
	case 'alt':
		testType = 'in';
		testParams = getListTestParams();
		break;
	case '!between':
		invert = true;
	case 'between':
		testType = 'between';
		testParams = getTwoTestParams();
		break;
	case '!contains':
		invert = true;
	case 'contains':
		testType = 'contains';
		testParams = getSingleTestParam();
		break;
	case '!containsi':
	case '!substring':
		invert = true;
	case 'containsi':
	case 'substring':
		testType = 'containsi';
		testParams = getSingleTestParam();
		break;
	case '!starts':
		invert = true;
	case 'starts':
		testType = 'starts';
		testParams = getSingleTestParam();
		break;
	case '!startsi':
	case '!prefix':
		invert = true;
	case 'startsi':
	case 'prefix':
		testType = 'startsi';
		testParams = getSingleTestParam();
		break;
	case '!matches':
		invert = true;
	case 'matches':
		testType = 'matches';
		testParams = getSingleTestParam();
		break;
	case '!matchesi':
	case '!pattern':
	case '!re':
		invert = true;
	case 'matchesi':
	case 'pattern':
	case 're':
		testType = 'matchesi';
		testParams = getSingleTestParam();
		break;
	case '!empty':
	case 'present':
		invert = true;
	case 'empty':
		testType = 'empty';
		if (testSpec.length > 1)
			throw error(`test "${rawTestType}" expects no arguments.`);
		break;
	default:
		throw error(`unknown test "${rawTestType}".`);
	}
	/* eslint-enable no-fallthrough */

	// compile value expressions in test params if any
	if (testParams) {
		for (let i = 0, len = testParams.length; i < len; i++) {
			const testParam = testParams[i];
			if (placeholders.isExpr(testParam)) {
				testParams[i] = new ValueExpression(
					valueExprCtx, testParam.expr);
			}
		}
	}

	// create and return the resulting test
	return new RecordsFilterValueTest(valueExpr, testType, invert, testParams);
}

// export the builder function
exports.buildFilter = buildFilter;
